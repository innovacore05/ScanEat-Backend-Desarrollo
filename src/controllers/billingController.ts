import { Response } from "express";
import { and,eq,isNull } from "drizzle-orm";
import {z} from "zod";   
import { AuthRequest } from "../middleware/authenticate";
import db from "../db/connection";
import { orderDetails,orders,orderStatuses } from "../db/schemas/orderSchema";
import { tables } from "../db/schemas/mesaSchema";  
import { products } from "../db/schemas/adminMenuSchema";   

import  {payments, receiptDetails, receipts } from "../db/schemas/billingSchema";

const TAX_RATE=0.13;

const roundCurrency=(value:number)=>
    Math.round((value+Number.EPSILON) * 100) /100; 
    
type LineRow={
  detail:{
    detailId:number;
    quantity:number;
    unitPrice:string;
    discountAmount:string;
    subtotal:string;
  };
  product:{productName:string};
};
const buildLines = (rows: LineRow[]) =>
  rows.map((row) => {
    const unitPrice = Number(row.detail.unitPrice);
    const quantity = row.detail.quantity;
    const discount = Number(row.detail.discountAmount);
    const subtotal = Number(row.detail.subtotal);

    const gross = roundCurrency(unitPrice * quantity);
    const tax = roundCurrency(subtotal * TAX_RATE);
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
      total: total.toFixed(2),
    };
  });

export const getPaymentPreview = async (req: AuthRequest, res: Response) => {
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
        product: products,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .innerJoin(orderDetails, eq(orders.orderId, orderDetails.orderId))
      .innerJoin(products, eq(orderDetails.productId, products.productId))
      .where(
        and(eq(orders.orderId, orderId), eq(tables.businessId, businessId)),
      );

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

    const lines = buildLines(rows);

    const totalDiscount = lines.reduce(
      (sum, line) => sum + Number(line.discount),
      0,
    );

    return res.status(200).json({
      orderId: firstRow.order.orderId,
      tableNumber: firstRow.table.tableNumber,
      lines,
      totals: {
        totalSale: firstRow.order.total,
        totalDiscount: totalDiscount.toFixed(2),
        totalNetSale: firstRow.order.subtotal,
        totalTax: firstRow.order.tax,
        serviceCharge: "0.00",
        totalOtherCharges: "0.00",
        totalVoucher: "0.00",
      },
      missingCabys: [],
    });
  } catch (error) {
    console.error("Error obteniendo preview de pago:", error);

    return res.status(500).json({
      message: "No se pudo cargar la información de pago",
    });
  }
};

const payOrderSchema = z.union([
  z.object({
    method: z.literal("cash"),
    amountTendered: z.coerce.number().positive(),
  }),
  z.object({
    method: z.enum(["card", "sinpe"]),
    reference: z.string().trim().min(1).max(50),
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
        );

      if (rows.length === 0) {
        return { type: "not-found" as const };
      }

      const { order, table } = rows[0];
      const total = Number(order.total);

      // se valida ANTES de marcar la orden como pagada
      if (payload.method === "cash" && payload.amountTendered < total) {
        return { type: "insufficient" as const };
      }

      // "reclama" la orden: si otro cobro ya la tomó, no devuelve filas
      const [claimed] = await tx
        .update(orders)
        .set({ state: orderStatuses.paid, paidAt: new Date() })
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

      const lines = buildLines(rows);
      const totalDiscount = lines.reduce(
        (sum, line) => sum + Number(line.discount),
        0,
      );

      const [receipt] = await tx
        .insert(receipts)
        .values({
          businessId,
          orderId,
          documentType: "04", // tiquete electrónico
          totalSale: order.total,
          totalDiscount: totalDiscount.toFixed(2),
          totalNetSale: order.subtotal,
          totalTax: order.tax,
          cashierId,
        })
        .returning();

      await tx.insert(receiptDetails).values(
        lines.map((line, index) => ({
          receiptId: receipt.receiptId,
          orderDetailId: line.detailId,
          lineNumber: index + 1,
          cabysCode: "0000000000000", // PENDIENTE: no es un código real
          detail: line.detail,
          quantity: String(line.quantity),
          unitPrice: line.unitPrice,
          discountAmount: line.discount,
          subtotal: line.subtotal,
          taxAmount: line.tax,
          lineTotal: line.total,
        })),
      );

      const change =
        payload.method === "cash"
          ? roundCurrency(payload.amountTendered - total)
          : null;

      await tx.insert(payments).values({
        receiptId: receipt.receiptId,
        method: METHOD_CODES[payload.method],
        reference: payload.method === "cash" ? null : payload.reference,
        amount: order.total,
        amountTendered:
          payload.method === "cash" ? payload.amountTendered.toFixed(2) : null,
        changeGiven: change === null ? null : change.toFixed(2),
        cashierId,
      });

      return {
        type: "paid" as const,
        receipt,
        table,
        order,
        lines,
        totalDiscount,
        change,
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

    const { receipt, table, order, lines, totalDiscount, change } = result;

    return res.status(201).json({
      receiptId: receipt.receiptId,
      orderId,
      tableNumber: table.tableNumber,
      documentType: receipt.documentType,
      issueDate: receipt.issueDate,
      haciendaStatus: receipt.haciendaStatus,
      lines,
      totals: {
        totalSale: order.total,
        totalDiscount: totalDiscount.toFixed(2),
        totalNetSale: order.subtotal,
        totalTax: order.tax,
        serviceCharge: "0.00",
        totalOtherCharges: "0.00",
        totalVoucher: "0.00",
      },
      payment: {
        method: payload.method,
        reference: payload.method === "cash" ? null : payload.reference,
        amount: order.total,
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