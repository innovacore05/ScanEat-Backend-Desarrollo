import { Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { products } from "../db/schemas/adminMenuSchema";
import { tables } from "../db/schemas/mesaSchema";
import {
  createOrderSchema,
  orderStatuses,
  orderDetails,
  orders,
} from "../db/schemas/orderSchema";

const TAX_RATE = 0.13;

const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeOrderState = (value?: string) => {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();

  const aliases: Record<string, string> = {
    pending: orderStatuses.pending,
    pendiente: orderStatuses.pending,
    in_preparation: orderStatuses.inPreparation,
    "en preparación": orderStatuses.inPreparation,
    "en preparacion": orderStatuses.inPreparation,
    ready: orderStatuses.ready,
    listo: orderStatuses.ready,
    delivered: orderStatuses.delivered,
    entregado: orderStatuses.delivered,
  };

  return aliases[normalized] ?? normalized;
};

const transitionOrderState = async (
  req: Request,
  res: Response,
  { from, to, actionLabel }: { from: string; to: string; actionLabel: string },
) => {
  try {
    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ message: "El identificador de la orden no es válido" });
    }

    const [updatedOrder] = await db
      .update(orders)
      .set({ state: to })
      .where(and(eq(orders.orderId, orderId), eq(orders.state, from)))
      .returning();

    if (updatedOrder) {
      return res.status(200).json({
        message: `Orden ${actionLabel} correctamente`,
        order: updatedOrder,
      });
    }

    const [currentOrder] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.orderId, orderId))
      .limit(1);

    if (!currentOrder) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    return res.status(409).json({
      message: `La orden solo puede ser ${actionLabel} cuando está en estado ${from}`,
    });
  } catch (error) {
    console.error(`Error al ${actionLabel} la orden:`, error);
    return res.status(500).json({ message: `No se pudo ${actionLabel} la orden` });
  }
};

//Crear orden
export const createOrder = async (req: Request, res: Response) => {
  const parsed = createOrderSchema.parse(req.body);

  try {
    const result = await db.transaction(async (tx) => {
      const [table] = await tx
        .select({ id: tables.id })
        .from(tables)
        .where(and(eq(tables.id, parsed.tableId), eq(tables.active, true)))
        .limit(1);

      if (!table) {
        return { type: "table-not-found" as const };
      }

      const productRows = await tx
        .select({
          productId: products.productId,
          price: products.price,
        })
        .from(products)
        .where(inArray(products.productId, parsed.items.map((item) => item.productId)));

      const prices = new Map(productRows.map((product) => [product.productId, Number(product.price)]));
      const missingProduct = parsed.items.find((item) => !prices.has(item.productId));

      if (missingProduct) {
        return { type: "product-not-found" as const, productId: missingProduct.productId };
      }

      const detailValues = parsed.items.map((item) => {
        const unitPrice = prices.get(item.productId)!;
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
          subtotal: roundCurrency(unitPrice * item.quantity),
        };
      });

      const subtotal = roundCurrency(
        detailValues.reduce((sum, detail) => sum + detail.subtotal, 0),
      );
      const tax = roundCurrency(subtotal * TAX_RATE);
      const total = roundCurrency(subtotal + tax);

      const [order] = await tx
        .insert(orders)
        .values({
          tableId: parsed.tableId,
          observation: parsed.observation || null,
          subtotal: subtotal.toFixed(2),
          tax: tax.toFixed(2),
          total: total.toFixed(2),
          state: orderStatuses.pending,
        })
        .returning();

      await tx.insert(orderDetails).values(
        detailValues.map((detail) => ({
          orderId: order.orderId,
          productId: detail.productId,
          quantity: detail.quantity,
          unitPrice: detail.unitPrice,
          subtotal: detail.subtotal.toFixed(2),
        })),
      );

      return { type: "created" as const, order, details: detailValues };
    });

    if (result.type === "table-not-found") {
      return res.status(404).json({ message: "Mesa no encontrada o inactiva" });
    }

    if (result.type === "product-not-found") {
      return res.status(404).json({
        message: `Producto no encontrado: ${result.productId}`,
      });
    }

    return res.status(201).json({
      order: result.order,
      details: result.details,
    });
  } catch (error) {
    console.error("Error creando pedido:", error);
    return res.status(500).json({ message: "No se pudo crear el pedido" });
  }
};

export const confirmOrder = async (req: Request, res: Response) => {
  return transitionOrderState(req, res, {
    from: orderStatuses.pending,
    to: orderStatuses.inPreparation,
    actionLabel: "confirmar",
  });
};

export const markOrderReady = async (req: Request, res: Response) => {
  return transitionOrderState(req, res, {
    from: orderStatuses.inPreparation,
    to: orderStatuses.ready,
    actionLabel: "marcar como listo",
  });
};

export const deliverOrder = async (req: Request, res: Response) => {
  return transitionOrderState(req, res, {
    from: orderStatuses.ready,
    to: orderStatuses.delivered,
    actionLabel: "entregar",
  });
};

//Obtener la orden
export const getOrders = async (req: Request, res: Response) => {
  try {
    const rawState = req.query.state;
    const stateValue =
      typeof rawState === "string"
        ? rawState
        : Array.isArray(rawState) && typeof rawState[0] === "string"
          ? rawState[0]
          : undefined;

    const stateParam = normalizeOrderState(stateValue);

    const query = db
      .select({
        order: orders,
        table: tables,
        detail: orderDetails,
        product: {
          productId: products.productId,
          productName: products.productName,
        },
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .leftJoin(orderDetails, eq(orders.orderId, orderDetails.orderId))
      .leftJoin(products, eq(orderDetails.productId, products.productId))
      .orderBy(desc(orders.date), desc(orders.orderId));

    const ordersById = new Map<number, {
      order: typeof rows[number]["order"];
      table: typeof rows[number]["table"];
      details: Array<{
        detailId: number;
        productId: number;
        productName: string;
        quantity: number;
        unitPrice: string;
        subtotal: string;
      }>;
    }>();

    for (const row of rows) {
      let current = ordersById.get(row.order.orderId);
      if (!current) {
        current = { order: row.order, table: row.table, details: [] };
        ordersById.set(row.order.orderId, current);
      }

      if (row.detail && row.product) {
        current.details.push({
          detailId: row.detail.detailId,
          productId: row.product.productId,
          productName: row.product.productName,
          quantity: row.detail.quantity,
          unitPrice: row.detail.unitPrice,
          subtotal: row.detail.subtotal,
        });
      }
    }

    return res.status(200).json(Array.from(ordersById.values()));
  } catch (error) {
    console.error("Error obteniendo pedidos:", error);
    return res.status(500).json({ message: "No se pudieron obtener los pedidos" });
  }
};


