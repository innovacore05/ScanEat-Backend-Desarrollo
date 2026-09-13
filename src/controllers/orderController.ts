import { Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import {
  modifierGroups,
  modifierOptions,
  products,
} from "../db/schemas/adminMenuSchema";
import { tables } from "../db/schemas/mesaSchema";
import {
  createOrderSchema,
  orderDetails,
  orders,
} from "../db/schemas/orderSchema";

const TAX_RATE = 0.13;

const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

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
          selectedOptions: item.selectedOptions,
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
        })
        .returning();

      await tx.insert(orderDetails).values(
        detailValues.map((detail) => ({
          orderId: order.orderId,
          productId: detail.productId,
          quantity: detail.quantity,
          unitPrice: detail.unitPrice,
          subtotal: detail.subtotal.toFixed(2),
          selectedOptions: detail.selectedOptions,
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

//Obtener la orden
export const getOrders = async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        order: orders,
        table: tables,
        detail: orderDetails,
        product: {
          productId: products.productId,
          productName: products.productName,
          isCustom: products.isCustom,
        },
        modifierGroup: modifierGroups,
        modifierOption: modifierOptions,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .leftJoin(orderDetails, eq(orders.orderId, orderDetails.orderId))
      .leftJoin(products, eq(orderDetails.productId, products.productId))
      .leftJoin(modifierGroups, eq(products.productId, modifierGroups.productId))
      .leftJoin(modifierOptions, eq(modifierGroups.id, modifierOptions.groupId))
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
        isCustom: number | null;
        selectedOptions: Record<string, string>;
        optionGroups: Array<{
          id: number;
          name: string;
          options: Array<{
            id: number;
            name: string;
          }>;
        }>;
      }>;
    }>();

    for (const row of rows) {
      let current = ordersById.get(row.order.orderId);
      if (!current) {
        current = { order: row.order, table: row.table, details: [] };
        ordersById.set(row.order.orderId, current);
      }

      if (row.detail && row.product) {
        let detail = current.details.find(
          (item) => item.detailId === row.detail!.detailId,
        );

        if (!detail) {
          detail = {
            detailId: row.detail.detailId,
            productId: row.product.productId,
            productName: row.product.productName,
            quantity: row.detail.quantity,
            unitPrice: row.detail.unitPrice,
            subtotal: row.detail.subtotal,
            isCustom: row.product.isCustom,
            selectedOptions: row.detail.selectedOptions,
            optionGroups: [],
          };
          current.details.push(detail);
        }

        if (row.product.isCustom === 1 && row.modifierGroup) {
          let optionGroup = detail.optionGroups.find(
            (group) => group.id === row.modifierGroup!.id,
          );

          if (!optionGroup) {
            optionGroup = {
              id: row.modifierGroup.id,
              name: row.modifierGroup.name,
              options: [],
            };
            detail.optionGroups.push(optionGroup);
          }

          if (
            row.modifierOption &&
            !optionGroup.options.some(
              (option) => option.id === row.modifierOption!.id,
            )
          ) {
            optionGroup.options.push({
              id: row.modifierOption.id,
              name: row.modifierOption.name,
            });
          }
        }
      }
    }

    return res.status(200).json(Array.from(ordersById.values()));
  } catch (error) {
    console.error("Error obteniendo pedidos:", error);
    return res.status(500).json({ message: "No se pudieron obtener los pedidos" });
  }
};
