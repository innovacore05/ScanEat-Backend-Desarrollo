import { Response } from "express";
import { and, eq, isNull, sql ,asc} from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/authenticate";
import db from "../db/connection";
import { orderDetails, orders, orderStatuses } from "../db/schemas/orderSchema";
import { tables } from "../db/schemas/mesaSchema";
import { products } from "../db/schemas/adminMenuSchema";

import  {invoicingConfig,payments, receiptDetails, receiptTaxes,receipts } from "../db/schemas/billingSchema";

import { sharedCarts } from "../db/schemas/sharedCartSchema";
import { emitToTable, emitOrderChanged } from "../socket";
import { emitTiquete,refreshReceiptStatus } from "../services/factura.service";
import { otherCharges } from "../db/schemas/billingSchema"; 
import { TiquetePayloadBuilder } from "../services/payloadBulder.service";


const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

type LineRow = {
  detail: {
    detailId: number;
    productId: number;
    quantity: number;
    unitPrice: string;
    discountAmount: string;
    subtotal: string;
    cabysCode: string | null;
    ivaRate: string | null;
    ivaRateCode: string | null;
    taxAmount: string | null;
  };
  product: {
    productName: string;
  };
};

const findMissingFiscalLine = (rows: LineRow[], chargesVat: boolean | null) =>
  rows.find(({ detail }) =>{
    if (!detail.cabysCode || !/^\d{13}$/.test(detail.cabysCode)) return true;
     // simplificado: no se exige IVA
    if (chargesVat === false) return false;

    const ivaRate = detail.ivaRate === null ? null : Number(detail.ivaRate);
    const taxAmount = detail.taxAmount === null ? null : Number(detail.taxAmount);

    return (
      !detail.ivaRateCode ||
      !/^\d{2}$/.test(detail.ivaRateCode) ||
      ivaRate === null ||
      !Number.isFinite(ivaRate) ||
      ivaRate < 0 ||
      ivaRate > 100 ||
      taxAmount === null ||
      !Number.isFinite(taxAmount) ||
      taxAmount < 0
    );
  });
 type IssuerRow=typeof invoicingConfig.$inferSelect;

const REGIME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const REQUIRED_ISSUER_FIELDS: Array<[keyof IssuerRow, string]> = [
  ["legalIdType", "tipo de identificación"],
  ["legalId", "cédula"],
  ["legalName", "nombre o razón social"],
  ["activityCode", "actividad económica"],
  ["email", "correo"],
  ["phone", "teléfono"],
  ["province", "provincia"],
  ["canton", "cantón"],
  ["district", "distrito"],
  ["address", "dirección"],
];

const getIssuerProblem = (issuer: IssuerRow | undefined): string | null => {
  if (!issuer) {
    return "Falta configurar los datos fiscales del emisor.";
  }

  const missing = REQUIRED_ISSUER_FIELDS.filter(([key]) => !issuer[key]).map(
    ([, label]) => label,
  );

  if (missing.length > 0) {
    return `Faltan datos del emisor: ${missing.join(", ")}.`;
  }

   if (issuer.chargesVat === null || issuer.chargesVat === undefined) {
    return "Falta verificar el régimen del emisor. Guardá los datos del emisor para consultarlo.";
  }

  const regimeAge = issuer.regimeVerifiedAt
  ? Date.now() - issuer.regimeVerifiedAt.getTime()
  : null;

if (
  regimeAge === null ||
  regimeAge < 0 ||
  regimeAge > REGIME_MAX_AGE_MS
) {
  return "La verificación del régimen venció. Guardá de nuevo los datos del emisor para verificarlo.";
}

  if (!issuer.certificateUploadedAt) {
    return "No hay constancia de que el certificado del emisor se haya cargado.";
  }

  return null;
};


const buildLines = (rows: LineRow[], chargesVat: boolean | null) =>
  rows.map((row) => {
    const vat = chargesVat !== false;
    const unitPrice = Number(row.detail.unitPrice);
    const quantity = row.detail.quantity;
    const discount = Number(row.detail.discountAmount);
    const subtotal = Number(row.detail.subtotal);
    const tax = vat ? Number(row.detail.taxAmount) : 0;
    const gross = roundCurrency(unitPrice * quantity);
    const total = roundCurrency(subtotal + tax);

    return {
      detailId: row.detail.detailId,
      detail: row.product.productName,
      quantity,
      unitPrice: row.detail.unitPrice,
      gross: gross.toFixed(2),
      discount: discount.toFixed(2),
      subtotal: row.detail.subtotal,
      tax: tax.toFixed(2),
      cabysCode: row.detail.cabysCode!,
      ivaRate: vat ? row.detail.ivaRate! : "0.00",
      ivaRateCode: vat ? row.detail.ivaRateCode! : "10",
      total: total.toFixed(2),
    };
  });

type BuiltLine = ReturnType<typeof buildLines>[number];
const toCents = (value: string | number): number => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw new Error("Monto no válido");
  }

  return Math.round(amount * 100);
};

const fromCents = (cents: number): string =>
  (cents / 100).toFixed(2);

const allocatedDiscountCents = (
  totalDiscountCents: number,
  totalQuantity: number,
  alreadyPaid: number,
  selectedQuantity: number,
): number => {
  if (
    totalQuantity <= 0 ||
    alreadyPaid < 0 ||
    selectedQuantity < 0 ||
    alreadyPaid + selectedQuantity > totalQuantity
  ) {
    throw new Error("Cantidad no válida para distribuir el descuento");
  }

  const cumulative = (units: number) =>
    Number(
      (BigInt(totalDiscountCents) * BigInt(units)) /
        BigInt(totalQuantity),
    );

  return (
    cumulative(alreadyPaid + selectedQuantity) -
    cumulative(alreadyPaid)
  );
};

const taxCentsFor = (subtotalCents: number, ivaRate: string): number => {
  const rateBasisPoints = Math.round(Number(ivaRate) * 100);

  if (!Number.isFinite(rateBasisPoints) || rateBasisPoints < 0) {
    throw new Error("Tarifa de IVA no válida");
  }

  return Number(
    (BigInt(subtotalCents) * BigInt(rateBasisPoints) + 5_000n) /
      10_000n,
  );
};

const buildPartialLines = (
  lines: BuiltLine[],
  selectedItems: { detailId: number; quantity: number }[],
  paidQuantities: Map<number, number>,
) => {
  const selectedQuantities = new Map(
    selectedItems.map((item) => [item.detailId, item.quantity]),
  );

  return lines
    .filter((line) => selectedQuantities.has(line.detailId))
    .map((line) => {
      const quantity = selectedQuantities.get(line.detailId)!;
      const alreadyPaid = paidQuantities.get(line.detailId) ?? 0;

      const grossCents = toCents(line.unitPrice) * quantity;
      const discountCents = allocatedDiscountCents(
        toCents(line.discount),
        line.quantity,
        alreadyPaid,
        quantity,
      );
      const subtotalCents = grossCents - discountCents;
      const taxCents = taxCentsFor(subtotalCents, line.ivaRate);

      return {
        ...line,
        quantity,
        gross: fromCents(grossCents),
        discount: fromCents(discountCents),
        subtotal: fromCents(subtotalCents),
        tax: fromCents(taxCents),
        total: fromCents(subtotalCents + taxCents),
      };
    });
};

const buildTotals = (lines: BuiltLine[], includeService = false) => {
  const totalSaleCents = lines.reduce(
    (sum, line) => sum + toCents(line.gross),
    0,
  );
  const totalDiscountCents = lines.reduce(
    (sum, line) => sum + toCents(line.discount),
    0,
  );
  const totalNetSaleCents = lines.reduce(
    (sum, line) => sum + toCents(line.subtotal),
    0,
  );
  const totalTaxCents = lines.reduce(
    (sum, line) => sum + toCents(line.tax),
    0,
  );

  if (totalSaleCents - totalDiscountCents !== totalNetSaleCents) {
    throw new Error("Venta, descuento y venta neta no cuadran");
  }

  const serviceCents = includeService
    ? Math.floor((totalNetSaleCents + 5) / 10)
    : 0;

  return {
    totalSale: fromCents(totalSaleCents),
    totalDiscount: fromCents(totalDiscountCents),
    totalNetSale: fromCents(totalNetSaleCents),
    totalTax: fromCents(totalTaxCents),
    serviceCharge: fromCents(serviceCents),
    totalOtherCharges: fromCents(serviceCents),
    totalVoucher: fromCents(
      totalNetSaleCents + totalTaxCents + serviceCents,
    ),
  };
};

// desglose de IVA agrupado por tarifa, calculado con las mismas lineas
const buildTaxSummary = (lines: BuiltLine[]) => {
  const byRate = new Map<number, number>();

  for (const line of lines) {
    const rate = Number(line.ivaRate);

    byRate.set(rate, (byRate.get(rate) ?? 0) + toCents(line.tax));
  }

  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, cents]) => ({
      rate,
      amount: (cents / 100).toFixed(2),
    }));
};


export const getPaymentPreview = async (
  req: AuthRequest,
  res: Response,) => {
  try {
    const orderId = Number(req.params.orderId);
    const businessId = req.user?.business_id;

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "El identificador de la orden no es válido",
      });
    }

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const rows = await db
      .select({
        order: orders,
        table: tables,
        detail: orderDetails,
        product: {
          productName: products.productName,
        },
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .innerJoin(orderDetails, eq(orders.orderId, orderDetails.orderId))
      // cambys: relaciona cada detalle con su producto para obtener el nombre
      .innerJoin(products, eq(orderDetails.productId, products.productId))
      .where(
        and(
          eq(orders.orderId, orderId),
          eq(tables.businessId, businessId),
        ),
      ).for("update", { of: orders });
    if (rows.length === 0) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    const firstRow = rows[0];

    if (
      firstRow.order.state !== orderStatuses.delivered ||
      firstRow.order.paidAt
    ) {
      return res
        .status(409)
        .json({ message: "La orden no está pendiente de cobro" });
    }

 const [issuer] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);
 
    const issuerProblem = getIssuerProblem(issuer);
    if (issuerProblem) {
      return res.status(409).json({ message: issuerProblem });
    }

    // cabys:no mostrar un cobro si faltan datos fiscales
   const missingFiscalLine = findMissingFiscalLine(rows, issuer.chargesVat);

    if (missingFiscalLine) {
      return res.status(409).json({
        message:
          `El producto ${missingFiscalLine.detail.productId} no tiene ` +
          "CABYS e IVA completos. Revisa el producto o vuelve a crear el pedido.",
      });
    }
const includeService = req.query.service !== "false";
    const paidQuantities = await getPaidQuantities(orderId);

   const lines = buildLines(rows, issuer.chargesVat).map((line) => {
      const paidQuantity = paidQuantities.get(line.detailId) ?? 0;

      return {
        ...line,
        originalQuantity: line.quantity,
        paidQuantity,
        pendingQuantity: Math.max(0, line.quantity - paidQuantity),
      };
    });

    return res.status(200).json({
      orderId: firstRow.order.orderId,
      tableId: firstRow.order.tableId,
      tableNumber: firstRow.table.tableNumber,
      lines,
      totals: buildTotals(lines, includeService),
      taxSummary: buildTaxSummary(lines),
      chargesVat: issuer.chargesVat,
      missingCabys: [],
    });
 
     } catch (error) {
    console.error("Error obteniendo preview de pago:", error);
 
    return res.status(500).json({
      message: "No se pudo cargar la información de pago",
    });
  }
};

const itemsSchema = z
  .array(
    z.object({
      detailId: z.number().int().positive(),
      quantity: z.number().int().positive(),
    }),
  )
  .min(1);

const payOrderSchema = z.union([
  z.object({
    method: z.literal("cash"),
    amountTendered: z.coerce
  .number()
  .positive()
  .refine(
    (amount) =>
      Number.isFinite(amount) &&
      Math.abs(amount * 100 - Math.round(amount * 100)) < 0.0000001,
    "El efectivo debe tener máximo dos decimales",
  ),
    includeServiceCharge: z.boolean(),
    items: itemsSchema,
  }),
  z.object({
    method: z.enum(["card", "sinpe"]),
    reference: z.string().trim().min(1).max(50),
    includeServiceCharge: z.boolean(),
    items: itemsSchema,
  }),
]);




const METHOD_CODES = { cash: "01", card: "02", sinpe: "06" } as const;

export const payOrder = async (req: AuthRequest, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    const businessId = req.user?.business_id;
    const cashierId = req.user?.user_id;

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "El identificador de la orden no es válido",
      });
    }

    if (!businessId || !cashierId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const parsed = payOrderSchema.safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Los datos del cobro no son válidos" });
    }

    const payload = parsed.data;

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          order: orders,
          table: tables,
          detail: orderDetails,
          product: { productName: products.productName },
        })
        .from(orders)
        .innerJoin(tables, eq(orders.tableId, tables.id))
        .innerJoin(orderDetails, eq(orders.orderId, orderDetails.orderId))
        .innerJoin(products, eq(orderDetails.productId, products.productId))
        .where(
  and(eq(orders.orderId, orderId), eq(tables.businessId, businessId)),
)
.for("update", { of: orders });

      if (rows.length === 0) {
        return { type: "not-found" as const };
      }

      const { order, table } = rows[0];

      const [issuer] = await tx
        .select()
        .from(invoicingConfig)
        .where(eq(invoicingConfig.businessId, businessId))
        .limit(1);
 
      const issuerProblem = getIssuerProblem(issuer);
      if (!issuer || issuerProblem) {
        return {
          type: "issuer-incomplete" as const,
          message: issuerProblem ?? "Falta configurar los datos del emisor.",
        };
      }

      //cabys:valida los datos fiscales antes de marar pagado
   const missingFiscalLine = findMissingFiscalLine(rows, issuer.chargesVat);


      if (missingFiscalLine) {
        return {
          type: "missing-fiscal" as const,
          productId: missingFiscalLine.detail.productId,
        };
      }

      if (
        order.state !== orderStatuses.delivered ||
        order.paidAt
      ) {
        return { type: "not-payable" as const };
      }



      const paidRows = await tx
        .select({
          orderDetailId: receiptDetails.orderDetailId,
          paidQuantity: sql<string>`COALESCE(SUM(${receiptDetails.quantity}), 0)`,
        })
        .from(receiptDetails)
        .innerJoin(
          receipts,
          eq(receiptDetails.receiptId, receipts.receiptId),
        )
        .where(eq(receipts.orderId, orderId))
        .groupBy(receiptDetails.orderDetailId);

      const paidQuantities = new Map(
        paidRows
          .filter((row) => row.orderDetailId !== null)
          .map((row) => [
            row.orderDetailId as number,
            Number(row.paidQuantity),
          ]),
      );

      //--------------------------------
      const selectedItems = new Map(
        payload.items.map((item) => [item.detailId, item.quantity]),
      );

      const hasDuplicateItems =
        selectedItems.size !== payload.items.length;

      const hasInvalidQuantity =
        hasDuplicateItems ||
        payload.items.some((item) => {
          const originalLine = rows.find(
            (row) => row.detail.detailId === item.detailId,
          );

          if (!originalLine) return true;

          const alreadyPaid =
            paidQuantities.get(item.detailId) ?? 0;

          const pending =
            Number(originalLine.detail.quantity) - alreadyPaid;

          return item.quantity > pending;
        });

      if (hasInvalidQuantity) {
        return { type: "invalid-quantity" as const };
      }


      // regimen
      const allLines = buildLines(rows, issuer.chargesVat);

      const selectedItemsArray = payload.items;

      const lines = buildPartialLines(
  allLines,
  selectedItemsArray,
  paidQuantities,
);

      if (lines.length === 0) {
        return { type: "invalid-quantity" as const };
      }

      //-----------

      const totals = buildTotals(lines, payload.includeServiceCharge);
      const taxSummary = buildTaxSummary(lines);
      const total = Number(totals.totalVoucher);

      // se valida ANTES de marcar la orden como pagada
      if (payload.method === "cash" && payload.amountTendered < total) {
        return { type: "insufficient" as const };
      }

TiquetePayloadBuilder.build({
  emisorLegalId: issuer.legalId,
  paymentMethod: payload.method,
  total: totals.totalVoucher,
  serviceCharge: totals.serviceCharge,
  chargesVat: issuer.chargesVat !== false,
  lines: lines.map((line) => ({
    ...line,
    discountCode: "07",
  })),
});

   // comprobar si este cobro completa todas las cantidades de la orden
      const allQuantitiesPaid = rows.every((row) => {
        const alreadyPaid = paidQuantities.get(row.detail.detailId) ?? 0;
        const selectedQuantity = selectedItems.get(row.detail.detailId) ?? 0;
 
        return (
          alreadyPaid + selectedQuantity >=
          Number(row.detail.quantity)
        );
      });
 


    
      // Solo marcar como pagada si no quedan unidades pendientes.
      if (allQuantitiesPaid) {
        const [claimed] = await tx
          .update(orders)
          .set({
            state: orderStatuses.paid,
            paidAt: new Date(),
          })
          .where(
            and(
              eq(orders.orderId, orderId),
              eq(orders.state, orderStatuses.delivered),
              isNull(orders.paidAt),
            ),
          )
          .returning({ orderId: orders.orderId });

        if (!claimed) {
          return { type: "not-payable" as const };
        }
      }



      const cancelledCarts = allQuantitiesPaid
        ? await tx
          .update(sharedCarts)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(sharedCarts.tableId, order.tableId),
              eq(sharedCarts.status, "open"),
            ),
          )
          .returning({ id: sharedCarts.id })
        : [];




      const [receipt] = await tx
        .insert(receipts)
        .values({
          businessId,
          orderId,
          documentType: "04",
          environment: issuer.environment,
          totalSale: totals.totalSale,
          totalDiscount: totals.totalDiscount,
          totalNetSale: totals.totalNetSale,
          totalTax: totals.totalTax,
          totalOtherCharges: totals.totalOtherCharges,
          totalVoucher: totals.totalVoucher,
          cashierId,
        })
        .returning();

      // cabys:guardar el CABYS real del detalle del pedido
         const savedReceiptLines = await tx
        .insert(receiptDetails)
        .values(
          lines.map((line, index) => ({
            receiptId: receipt.receiptId,
            orderDetailId: line.detailId,
            lineNumber: index + 1,
            cabysCode: line.cabysCode,
            detail: line.detail,
            quantity: String(line.quantity),
            unitPrice: line.unitPrice,
            discountAmount: line.discount,
            subtotal: line.subtotal,
            taxAmount: line.tax,
            lineTotal: line.total,
          })),
        )
        .returning({
          detailId: receiptDetails.detailId,
          lineNumber: receiptDetails.lineNumber,
        });

      // cabys: guardar tarifa y monto de IVA 
       await tx.insert(receiptTaxes).values(
  savedReceiptLines.map((savedLine) => {
    const line = lines[savedLine.lineNumber - 1];
    return {
      detailId: savedLine.detailId,
      taxCode: "01",
      taxRateCode: line.ivaRateCode,
      taxRate: line.ivaRate,
      amount: line.tax,
    };
  }),
);
     
if (Number(totals.serviceCharge) > 0) {
  await tx.insert(otherCharges).values({
    receiptId: receipt.receiptId,
    chargeType: "06",
    detail: "Impuesto de servicio",
    percentage: "10.00",
    amount: totals.serviceCharge,
  });
}
    const changeCents =
  payload.method === "cash"
    ? toCents(payload.amountTendered) - toCents(totals.totalVoucher)
    : null;

const change =
  changeCents === null ? null : changeCents / 100;

      await tx.insert(payments).values({
        receiptId: receipt.receiptId,
        method: METHOD_CODES[payload.method],
        reference: payload.method === "cash" ? null : payload.reference,
        amount: totals.totalVoucher,

        amountTendered:
          payload.method === "cash" ? payload.amountTendered.toFixed(2) : null,
        changeGiven: change === null ? null : change.toFixed(2),
        cashierId,
      });


      return {
        type: "paid" as const,
        receipt,
        table,
        issuer,
        lines,
        totals,
        taxSummary,
        change,
        allQuantitiesPaid,
        cancelledCartIds: cancelledCarts.map((cart) => cart.id),
      };
    
    });
  
    if (result.type === "not-found") {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    if (result.type === "insufficient") {
      return res
        .status(400)
        .json({ message: "El monto recibido no cubre el total" });
    }

    if (result.type === "not-payable") {
      return res
        .status(409)
        .json({ message: "La orden no está pendiente de cobro" });
    }

    if (result.type === "invalid-quantity") {
      return res.status(409).json({
        message:
          "Una o más cantidades seleccionadas ya fueron cobradas " +
          "o superan las unidades pendientes.",
      });
    }

    if (result.type === "missing-fiscal") {
      return res.status(409).json({
        message:
          `El producto ${result.productId} no tiene CABYS e IVA completos. ` +
          "Revisa el producto o vuelve a crear el pedido.",
      });
    }


     if (result.type === "issuer-incomplete") {
      return res.status(409).json({ message: result.message });
    }



 const {
      receipt: createdReceipt,
      table,
      issuer,
      lines,
      totals,
      taxSummary,
      change,
      cancelledCartIds,
    } = result;



    for (const cartId of cancelledCartIds) {
      emitToTable(table.id, "cart:expired", { cartId });
    }

    if (result.allQuantitiesPaid) {
      emitOrderChanged({
        order_id: orderId,
        table_id: table.id,
        state: orderStatuses.paid,
        business_id: table.businessId,
      });
    } else {
      emitOrderChanged({
        order_id: orderId,
        table_id: table.id,
        state: orderStatuses.delivered,
        business_id: table.businessId,
      });
    }
const emitted = await emitTiquete({
      receiptId: createdReceipt.receiptId,
      orderId,
      issuer,
      lines,
      total: totals.totalVoucher,
      serviceCharge: totals.serviceCharge,
      chargesVat: issuer.chargesVat !== false,
      paymentMethod: payload.method,
    });
 
   const receipt = emitted.ok ? emitted.receipt : createdReceipt;

    return res.status(201).json({
      receiptId: receipt.receiptId,
      orderId,
      tableNumber: table.tableNumber,
      documentType: receipt.documentType,
      issueDate: receipt.issueDate,
      haciendaStatus: receipt.haciendaStatus,

 haciendaMessage: receipt.haciendaMessage,
      clave: receipt.clave,
      consecutiveNumber: receipt.consecutiveNumber,
      environment: receipt.environment,
      issuer: {
        legalName: issuer.legalName,
        tradeName: issuer.tradeName,
        legalId: issuer.legalId,
        legalIdType: issuer.legalIdType,
        phone: issuer.phone,
        address: issuer.address,
      },

      lines,
      totals,
      taxSummary,
      payment: {
        method: payload.method,
        reference: payload.method === "cash" ? null : payload.reference,
       amount: totals.totalVoucher,
        amountTendered:
          payload.method === "cash" ? payload.amountTendered.toFixed(2) : null,
        change: change === null ? null : change.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Error registrando el cobro:", error);

    return res.status(500).json({ message: "No se pudo registrar el cobro" });
  }
};





//funcion para intentar mandar otra vez lo de la factura sin cobrar doble
export const retryReceiptEmission = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const receiptId = Number(req.params.receiptId);
    const businessId = req.user?.business_id;

    if (!Number.isInteger(receiptId) || receiptId <= 0 || !businessId) {
      return res.status(400).json({ message: "Solicitud no válida" });
    }

    const [receipt] = await db
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.receiptId, receiptId),
          eq(receipts.businessId, businessId),
        ),
      )
      .limit(1);

    if (!receipt) {
      return res.status(404).json({ message: "Recibo no encontrado" });
    }

    if (receipt.haciendaStatus !== "not_sent" || receipt.integratorDocumentId) {
      return res.status(409).json({
        message: "Este recibo no está pendiente de emisión",
        haciendaStatus: receipt.haciendaStatus,
      });
    }

    // La Idempotency-Key de Factura en CR tiene una ventana de 24 horas.
    // Usamos 23 para dejar margen respecto al momento exacto del primer envío.
    const safeRetryWindowMs = 23 * 60 * 60 * 1000;

    if (Date.now() - receipt.createdAt.getTime() >= safeRetryWindowMs) {
      return res.status(409).json({
        message:
          "Pasó el plazo seguro para reintentar. " +
          "Verificá el recibo con Factura en CR antes de emitirlo otra vez.",
      });
    }

    const [issuer] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    if (!issuer || !issuer.certificateUploadedAt) {
      return res.status(409).json({
        message: "El emisor no tiene un certificado cargado",
      });
    }

    if (
      issuer.environment !== receipt.environment ||
      issuer.updatedAt > receipt.createdAt
    ) {
      return res.status(409).json({
        message:
          "Los datos o el ambiente del emisor cambiaron desde el cobro. " +
          "Verificá la emisión antes de reintentar.",
      });
    }

    const savedLines = await db
      .select({
        detail: receiptDetails,
        taxCode: receiptTaxes.taxCode,
        taxRateCode: receiptTaxes.taxRateCode,
        taxRate: receiptTaxes.taxRate,
      })
      .from(receiptDetails)
      .innerJoin(
        receiptTaxes,
        eq(receiptTaxes.detailId, receiptDetails.detailId),
      )
      .where(eq(receiptDetails.receiptId, receiptId))
      .orderBy(asc(receiptDetails.lineNumber));

    if (
      savedLines.length === 0 ||
      savedLines.some((line) => line.taxCode !== "01")
    ) {
      return res.status(409).json({
        message: "No se pudieron reconstruir los impuestos del recibo",
      });
    }

    const savedPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.receiptId, receiptId))
      .limit(2);

    if (savedPayments.length !== 1) {
      return res.status(409).json({
        message: "No se pudo identificar el método de pago del recibo",
      });
    }

    const paymentMethods = {
      "01": "cash",
      "02": "card",
      "06": "sinpe",
    } as const;

    const paymentMethod =
      paymentMethods[
        savedPayments[0].method as keyof typeof paymentMethods
      ];

    if (!paymentMethod) {
      return res.status(409).json({
        message: "El método de pago guardado no es válido",
      });
    }

    const savedCharges = await db
      .select()
      .from(otherCharges)
      .where(eq(otherCharges.receiptId, receiptId));

    if (savedCharges.some((charge) => charge.chargeType !== "06")) {
      return res.status(409).json({
        message: "Este recibo tiene cargos que el reintento no puede reconstruir",
      });
    }

    const serviceCharge = savedCharges
      .reduce((sum, charge) => sum + Number(charge.amount), 0)
      .toFixed(2);

    const lines = savedLines.map(({ detail, taxRateCode, taxRate }) => ({
      detail: detail.detail,
      quantity: Number(detail.quantity),
      unitPrice: detail.unitPrice,
      discount: detail.discountAmount,
      subtotal: detail.subtotal,
      tax: detail.taxAmount,
      cabysCode: detail.cabysCode,
      ivaRate: taxRate,
      ivaRateCode: taxRateCode,
    }));

    const emission = await emitTiquete({
      receiptId,
      orderId: receipt.orderId,
      issuer,
      lines,
      total: receipt.totalVoucher,
      serviceCharge,
      // Usa los códigos y tarifas guardados en cada línea.
      chargesVat: true,
      paymentMethod,
    });

    if (!emission.ok) {
      if (emission.code === "idempotency_in_progress") {
        return res.status(409).json({
          message: "Factura en CR todavía está procesando el tiquete.",
          retryAfterSeconds: emission.retryAfterSeconds ?? 5,
        });
      }

      return res.status(502).json({
        message: "No se pudo reintentar la emisión",
        providerStatus: emission.status,
        code: emission.code,
        detail: emission.message,
      });
    }

    return res.status(200).json({
      receiptId: emission.receipt.receiptId,
      haciendaStatus: emission.receipt.haciendaStatus,
      clave: emission.receipt.clave,
      consecutiveNumber: emission.receipt.consecutiveNumber,
    });
  } catch (error) {
    console.error("Error reintentando la emisión del recibo:", error);

    return res.status(500).json({
      message: "No se pudo reintentar la emisión",
    });
  }
};
//----------------------------------
//funcion para tratar tickets rechazados
export const replaceRejectedReceipt = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const receiptId = Number(req.params.receiptId);
    const businessId = req.user?.business_id;

    if (!Number.isInteger(receiptId) || receiptId <= 0 || !businessId) {
      return res.status(400).json({ message: "Solicitud no válida" });
    }

    const [original] = await db
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.receiptId, receiptId),
          eq(receipts.businessId, businessId),
        ),
      )
      .limit(1);

    if (!original) {
      return res.status(404).json({ message: "Recibo no encontrado" });
    }

    if (original.haciendaStatus !== "rejected" || !original.clave) {
      return res.status(409).json({
        message: "Solo se puede sustituir un recibo rechazado con clave",
        haciendaStatus: original.haciendaStatus,
      });
    }

    const [existingReplacement] = await db
      .select({ receiptId: receipts.receiptId })
      .from(receipts)
      .where(eq(receipts.replacesReceiptId, original.receiptId))
      .limit(1);

    if (existingReplacement) {
      return res.status(409).json({
        message: "Este recibo ya tiene un comprobante sustituto",
        replacementReceiptId: existingReplacement.receiptId,
      });
    }

    // En el siguiente paso se crea el nuevo recibo y se emite como sustituto.
    
    const [issuer] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    if (
      !issuer ||
      !issuer.certificateUploadedAt ||
      issuer.environment !== original.environment ||
      issuer.updatedAt > original.createdAt
    ) {
      return res.status(409).json({
        message:
          "Verificá los datos, el certificado y el ambiente del emisor antes de sustituir",
      });
    }

    
    
  const savedPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.receiptId, original.receiptId))
    .limit(2);

  if (savedPayments.length !== 1) {
    return res.status(409).json({
      message: "No se pudo identificar el método de pago original",
    });
  }

  const paymentMethods = {
    "01": "cash",
    "02": "card",
    "06": "sinpe",
  } as const;

  const paymentMethod =
    paymentMethods[savedPayments[0].method as keyof typeof paymentMethods];

  if (!paymentMethod) {
    return res.status(409).json({
      message: "El método de pago guardado no es válido",
    });
  }

    const replacement = await db.transaction(async (tx) => {
  const [lockedOriginal] = await tx
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.receiptId, receiptId),
        eq(receipts.businessId, businessId),
      ),
    )
    .for("update")
    .limit(1);

   if (
    !lockedOriginal ||
    lockedOriginal.haciendaStatus !== "rejected" ||
    !lockedOriginal.clave
  ) {
    return {
      conflict: true as const,
      replacementReceiptId: undefined,
    };
  }

  const [existing] = await tx
    .select({ receiptId: receipts.receiptId })
    .from(receipts)
    .where(eq(receipts.replacesReceiptId, lockedOriginal.receiptId))
    .limit(1);

  if (existing) {
    return {
      conflict: true as const,
      replacementReceiptId: existing.receiptId,
    };
  }

const originalDetails = await tx
    .select()
    .from(receiptDetails)
    .where(eq(receiptDetails.receiptId, lockedOriginal.receiptId))
    .orderBy(asc(receiptDetails.lineNumber));

  if (originalDetails.length === 0) {
    return {
      conflict: true as const,
      replacementReceiptId: undefined,
    };
  }


  const [created] = await tx
    .insert(receipts)
    .values({
      businessId: lockedOriginal.businessId,
      orderId: lockedOriginal.orderId,
      documentType: lockedOriginal.documentType,
      environment: lockedOriginal.environment,
      situation: lockedOriginal.situation,
      saleCondition: lockedOriginal.saleCondition,
      currency: lockedOriginal.currency,
      recipientId: lockedOriginal.recipientId,
      observations: lockedOriginal.observations,
      totalSale: lockedOriginal.totalSale,
      totalDiscount: lockedOriginal.totalDiscount,
      totalNetSale: lockedOriginal.totalNetSale,
      totalTax: lockedOriginal.totalTax,
      totalOtherCharges: lockedOriginal.totalOtherCharges,
      totalVoucher: lockedOriginal.totalVoucher,
      cashierId: lockedOriginal.cashierId,
      replacesReceiptId: lockedOriginal.receiptId,
    })
    .returning();
const originalPayment = savedPayments[0];

await tx.insert(payments).values({
  receiptId: created.receiptId,
  method: originalPayment.method,
  reference: originalPayment.reference,
  amount: originalPayment.amount,
  amountTendered: originalPayment.amountTendered,
  changeGiven: originalPayment.changeGiven,
  cashierId: originalPayment.cashierId,
});
 

  for (const detail of originalDetails) {
    const [createdDetail] = await tx
      .insert(receiptDetails)
      .values({
        receiptId: created.receiptId,
        orderDetailId: null,
        lineNumber: detail.lineNumber,
        cabysCode: detail.cabysCode,
        detail: detail.detail,
        quantity: detail.quantity,
        unitMeasure: detail.unitMeasure,
        unitPrice: detail.unitPrice,
        discountAmount: detail.discountAmount,
        discountCode: detail.discountCode,
        discountNature: detail.discountNature,
        subtotal: detail.subtotal,
        taxAmount: detail.taxAmount,
        lineTotal: detail.lineTotal,
      })
      .returning({ detailId: receiptDetails.detailId });

    const taxes = await tx
      .select()
      .from(receiptTaxes)
      .where(eq(receiptTaxes.detailId, detail.detailId));

    if (taxes.length > 0) {
      await tx.insert(receiptTaxes).values(
        taxes.map((tax) => ({
          detailId: createdDetail.detailId,
          taxCode: tax.taxCode,
          taxRateCode: tax.taxRateCode,
          taxRate: tax.taxRate,
          amount: tax.amount,
        })),
      );
    }
  }

  const charges = await tx
    .select()
    .from(otherCharges)
    .where(eq(otherCharges.receiptId, lockedOriginal.receiptId));

  if (charges.length > 0) {
    await tx.insert(otherCharges).values(
      charges.map((charge) => ({
        receiptId: created.receiptId,
        chargeType: charge.chargeType,
        detail: charge.detail,
        percentage: charge.percentage,
        amount: charge.amount,
      })),
    );
  }

  return { conflict: false as const, receipt: created };
});

if (replacement.conflict) {
  return res.status(409).json({
    message: "El recibo ya no se puede sustituir o ya tiene sustituto",
    replacementReceiptId: replacement.replacementReceiptId,
  });
}


  const savedLines = await db
    .select({
      detail: receiptDetails,
      taxCode: receiptTaxes.taxCode,
      taxRateCode: receiptTaxes.taxRateCode,
      taxRate: receiptTaxes.taxRate,
    })
    .from(receiptDetails)
    .innerJoin(
      receiptTaxes,
      eq(receiptTaxes.detailId, receiptDetails.detailId),
    )
    .where(eq(receiptDetails.receiptId, replacement.receipt.receiptId))
    .orderBy(asc(receiptDetails.lineNumber));

  if (
    savedLines.length === 0 ||
    savedLines.some((line) => line.taxCode !== "01")
  ) {
    return res.status(409).json({
      message: "No se pudieron reconstruir las líneas y los impuestos",
      replacementReceiptId: replacement.receipt.receiptId,
    });
  }

  const savedCharges = await db
    .select()
    .from(otherCharges)
    .where(eq(otherCharges.receiptId, replacement.receipt.receiptId));

  if (savedCharges.some((charge) => charge.chargeType !== "06")) {
    return res.status(409).json({
      message: "El recibo tiene cargos que no se pueden reconstruir",
      replacementReceiptId: replacement.receipt.receiptId,
    });
  }

  const serviceCharge = savedCharges
    .reduce((sum, charge) => sum + Number(charge.amount), 0)
    .toFixed(2);

  const lines = savedLines.map(({ detail, taxRateCode, taxRate }) => ({
    detail: detail.detail,
    quantity: Number(detail.quantity),
    unitPrice: detail.unitPrice,
    discount: detail.discountAmount,
    subtotal: detail.subtotal,
    tax: detail.taxAmount,
    cabysCode: detail.cabysCode,
    ivaRate: taxRate,
    ivaRateCode: taxRateCode,
  }));

  const emission = await emitTiquete({
    receiptId: replacement.receipt.receiptId,
    orderId: replacement.receipt.orderId,
    issuer,
    lines,
    total: replacement.receipt.totalVoucher,
    serviceCharge,
    chargesVat: true,
    paymentMethod,
    substituteKey: original.clave,
  });

  if (!emission.ok) {
  return res.status(202).json({
    receiptId: replacement.receipt.receiptId,
    replacesReceiptId: original.receiptId,
    haciendaStatus: "not_sent",
    clave: null,
    consecutiveNumber: null,
    emissionError: emission.message,
  });
}

  return res.status(201).json({
    receiptId: emission.receipt.receiptId,
    replacesReceiptId: original.receiptId,
    haciendaStatus: emission.receipt.haciendaStatus,
    clave: emission.receipt.clave,
    consecutiveNumber: emission.receipt.consecutiveNumber,
  });
  
  } catch (error) {
    console.error("Error creando el recibo sustituto:", error);
    return res.status(500).json({
      message: "No se pudo crear el recibo sustituto",
    });
  }
};

export const getReceiptStatus = async (req: AuthRequest, res: Response) => {
  try {
    const receiptId = Number(req.params.receiptId);
    const businessId = req.user?.business_id;
 
    if (!Number.isInteger(receiptId) || receiptId <= 0 || !businessId) {
      return res.status(400).json({ message: "Solicitud no válida" });
    }
 
    const receipt = await refreshReceiptStatus(receiptId, businessId);
 
    if (!receipt) {
      return res.status(404).json({ message: "Recibo no encontrado" });
    }
 
    return res.json({
      receiptId: receipt.receiptId,
      haciendaStatus: receipt.haciendaStatus,
      haciendaMessage: receipt.haciendaMessage,
      clave: receipt.clave,
      consecutiveNumber: receipt.consecutiveNumber,
    });
  } catch (error) {
    console.error("Error consultando el estado del tiquete:", error);
    return res.status(502).json({ message: "No se pudo consultar el estado" });
  }
};


const getPaidQuantities = async (
  orderId: number,
) => {
  const rows = await db
    .select({
      orderDetailId: receiptDetails.orderDetailId,
      paidQuantity: sql<string>`COALESCE(SUM(${receiptDetails.quantity}), 0)`,
    })
    .from(receiptDetails)
    .innerJoin(
      receipts,
      eq(receiptDetails.receiptId, receipts.receiptId),
    )
    .where(eq(receipts.orderId, orderId))
    .groupBy(receiptDetails.orderDetailId);

  return new Map(
    rows
      .filter((row) => row.orderDetailId !== null)
      .map((row) => [
        row.orderDetailId as number,
        Number(row.paidQuantity),
      ]),
  );
};
