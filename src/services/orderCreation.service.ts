import { and, eq, inArray } from "drizzle-orm";
import { tables } from "../db/schemas/mesaSchema";
import { orderDetails, orders, orderStatuses } from "../db/schemas/orderSchema";
import { calculateOrderLines, roundCurrency } from "./orderPricing.service";
import { CartError, type Tx } from "./sharedCart.service";

type Lines = ReturnType<typeof calculateOrderLines>;

export const createOrderFromCart = async (
  tx: Tx,
  tableId: string,
  lines: Lines,
  observation?: string | null,
) => {
  const [table] = await tx
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.id, tableId), eq(tables.active, true)))
    .limit(1);
  if (!table) throw new CartError(404, "Mesa no encontrada o inactiva");

  // Mismos datos fiscales que exige payOrder: falla al enviar, no al cobrar
  const bad = lines.find((l) => {
    const iva = Number(l.ivaRate);
    return (
      !l.cabysCode ||
      !/^\d{13}$/.test(l.cabysCode) ||
      !l.ivaRateCode ||
      !Number.isFinite(iva) ||
      iva <= 0 ||
      iva > 100
    );
  });
  if (bad) {
    throw new CartError(409, `El producto ${bad.productId} no tiene CABYS e IVA configurados`);
  }

  const [active] = await tx
    .select({ orderId: orders.orderId })
    .from(orders)
    .where(
      and(
        eq(orders.tableId, tableId),
        inArray(orders.state, [
          orderStatuses.pending,
          orderStatuses.inPreparation,
          orderStatuses.ready,
          orderStatuses.delivered,
        ]),
      ),
    )
    .limit(1);
  if (active) throw new CartError(409, "El pedido de esta mesa ya fue enviado");

  const subtotal = roundCurrency(lines.reduce((s, l) => s + l.subtotal, 0));
  const tax = roundCurrency(lines.reduce((s, l) => s + l.taxAmount, 0));

  const [order] = await tx
    .insert(orders)
    .values({
      tableId,
      observation: observation || null,
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: roundCurrency(subtotal + tax).toFixed(2),
      state: orderStatuses.pending,
    })
    .returning();

  await tx.insert(orderDetails).values(
    lines.map((line) => ({
      orderId: order.orderId,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      preparationState: "pending",
      subtotal: line.subtotal.toFixed(2),
      taxAmount: line.taxAmount.toFixed(2),
      cabysCode: line.cabysCode,
      ivaRate: line.ivaRate,
      ivaRateCode: line.ivaRateCode,
      selectedOptions: line.selectedOptions,
      clientId: line.clientId,
    })),
  );

  return order;
};