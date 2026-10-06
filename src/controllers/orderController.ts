import { Request, Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  sum,
} from "drizzle-orm";
import { db } from "../db/connection";
import {
  modifierGroups,
  modifierOptions,
  products,
} from "../db/schemas/adminMenuSchema";
import { tables } from "../db/schemas/mesaSchema";
import {
  createOrderSchema,
  orderStatuses,
  orderDetails,
  orders,
  orderStatusSchema,
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
  req: AuthRequest,
  res: Response,
  { from, to, actionLabel }: { from: string; to: string; actionLabel: string },
) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }
    const orderId = Number(req.params.id);

    const [order] = await db
      .select({
        orderId: orders.orderId,
        state: orders.state,
        businessId: tables.businessId,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .where(eq(orders.orderId, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        message: "Orden no encontrada",
      });
    }

    if (order.businessId !== businessId) {
      return res.status(403).json({
        message: "No tienes permiso para modificar esta orden",
      });
    }

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
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .where(
        and(
          eq(orders.orderId, orderId),
          eq(tables.businessId, businessId),
        ),
      )
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
        .select({ id: tables.id, businessId: tables.businessId, })
        .from(tables)
        .where(and(
          eq(tables.id, parsed.tableId),
          eq(tables.active, true),
        ),
        )
        .limit(1);

      if (!table) {
        return { type: "table-not-found" as const };
      }
      //get precio
      const productRows = await tx
        .select({
          productId: products.productId,
          price: products.price,
          businessId: products.businessId,
          discount: products.discount,
        })
        .from(products)
        .where(
          inArray(
            products.productId,
            parsed.items.map((item) => item.productId),
          ),
        );

      // const prices = new Map
      //   (productRows.map((product) =>
      //     [product.productId,
      //     Number(product.price),
      //     ]),
      //   );
      //nuevo:precio+decuento:
      const productData = new Map(
        productRows.map((product) => [
          product.productId,
          {
            price: Number(product.price),
            discount: Number(product.discount ?? 0),
          },
        ]),
      );

      const missingProduct = parsed.items.find((item) =>
        !productData.has(item.productId),
      );
      if (missingProduct) {
        return {
          type: "product-not-found" as const,
          productId: missingProduct.productId
        };
      };

      const wrongBusinessProduct = productRows.find(
        (product) => product.businessId !== table.businessId
      );

      if (wrongBusinessProduct) {
        return {
          type: "product-not-in-business" as const,
          productId: wrongBusinessProduct.productId,
        };
      }

      //detalle cliente:
      const detailValues = parsed.items.map((item) => {
        const product = productData.get(item.productId)!;
        //nuevo
        const unitPrice = product.price;
        const discountPercent = product.discount;

        const gross = roundCurrency(
          unitPrice * item.quantity
        );

        const discountAmount = roundCurrency(
          gross * (discountPercent / 100)
        );

        const subTotal = roundCurrency(
          gross - discountAmount
        );


        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          subtotal: subTotal,
          selectedOptions: item.selectedOptions,
        };
      });


      //nuevo:la mesa tiene una orden activa?

      const [activeOrder] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.tableId, parsed.tableId),
            inArray(orders.state,
              [
                orderStatuses.pending,
                orderStatuses.inPreparation,
                orderStatuses.ready,
                orderStatuses.delivered,
              ]),
          ),
        )
        .limit(1);

      console.log("ACTIVE ORDER:", activeOrder);
      //si la orden activa , y , si el estado de la orden 
      //activa es no pendiente, entonces va a retornar que 
      //la orden ya esta procesandose, y que laorden esta activa
      if (activeOrder) {
        if (activeOrder.state !== orderStatuses.pending) {
          return {
            type: "order-already-processing" as const,
            order: activeOrder,
          };
        }


        //calculos de los productos agregados actuales y los que vienen

        const newItemSubtotal = roundCurrency(
          detailValues.reduce(
            (sum, detail) => sum + detail.subtotal,
            0,
          ),
        );
        //sumar los nuevos montos agregados
        const currentSubtotal = Number(activeOrder.subtotal);
        const newSubtotal = roundCurrency(
          currentSubtotal + newItemSubtotal,
        );

        //cambiar a futuro tomando en cuenta hacienda
        const newTax = roundCurrency(
          newSubtotal * TAX_RATE,
        );
        //recalculo del total
        const newTotal = roundCurrency(
          newSubtotal + newTax,
        );

        //actaulzia rorder
        const [updateOrder] = await tx
          .update(orders)
          .set({
            subtotal: newSubtotal.toFixed(2),
            tax: newTax.toFixed(2),
            total: newTotal.toFixed(2),
            observation:
              [activeOrder.observation, parsed.observation]
                .filter(Boolean)
                .join("\n"),
          })
          .where(eq(orders.orderId, activeOrder.orderId))
          .returning();

        //agregar los productos a la misma orden

        await tx.insert(orderDetails).values(
          detailValues.map((detail) => ({

            orderId: activeOrder.orderId,
            productId: detail.productId,
            quantity: detail.quantity,
            unitPrice: detail.unitPrice,
            discountAmount: detail.discountAmount,
            subtotal: detail.subtotal.toFixed(2),
            selectedOptions: detail.selectedOptions,
            clientId: parsed.clientId ?? null,
          })),
        );

        return {
          type: "updated" as const,
          order: updateOrder,
          details: detailValues
        };

      }

      //si la orden aciva no existe, se debe activar una nueva
      const subtotal = roundCurrency(
        detailValues.reduce(
          (sum, detail) => sum + detail.subtotal,
          0,
        ),
      );
      const tax = roundCurrency(
        subtotal * TAX_RATE,
      );

      const total = roundCurrency(
        subtotal + tax,
      );

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

      // Guardar los productos de la nueva orden
      await tx.insert(orderDetails).values(
        detailValues.map((detail) => ({
          orderId: order.orderId,
          productId: detail.productId,
          quantity: detail.quantity,
          unitPrice: detail.unitPrice,
          discountAmount: detail.discountAmount,
          subtotal: detail.subtotal.toFixed(2),
          selectedOptions: detail.selectedOptions,
          clientId: parsed.clientId ?? null,
        })),
      );

      return {
        type: "created" as const,
        order,
        details: detailValues,
      };
    });

    if (result.type === "table-not-found") {
      return res.status(404).json(
        { message: "Mesa no encontrada o inactiva" });
    }

    if (result.type === "product-not-found") {
      return res.status(404).json({
        message: `Producto no encontrado: ${result.productId}`,
      });
    }

    if (result.type === "product-not-in-business") {
      return res.status(403).json({
        message: `El producto no pertenece al negocio de la mesa`,
      });
    }


    if (result.type === "order-already-processing") {
      return res.status(409).json({
        message: "La orden de esta mesa ya está siendo procesada",
        orderId: result.order.orderId,
        state: result.order.state,

      });
    }//creada o actualzada

    return res
      .status
      (result.type === "created" ? 201 : 200,).json({
        order: result.order,
        details: result.details,
      });
  } catch (error) {
    console.error("Error creando pedido:", error);

    return res.status(500).json(
      { message: "No se pudo crear el pedido" });
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
export const getOrders = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }
    const rawState = req.query.state;
    const stateValue =
      typeof rawState === "string"
        ? rawState
        : Array.isArray(rawState) && typeof rawState[0] === "string"
          ? rawState[0]
          : undefined;

    const stateParam = normalizeOrderState(stateValue);

    const pendingPayment = req.query.pendingPayment === "true";

    const query = db
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
      .leftJoin(products, and(eq(orderDetails.productId, products.productId), eq(products.businessId, businessId))
      )
      .leftJoin(modifierGroups, eq(products.productId, modifierGroups.productId))
      .leftJoin(modifierOptions, eq(modifierGroups.id, modifierOptions.groupId));

    const whereConditions = [
      eq(tables.businessId, businessId),
      ...(stateParam ? [eq(orders.state, stateParam)] : []),
      ...(pendingPayment ? [isNull(orders.paidAt)] : []),
    ];


    // const rows = stateParam
    //   ? await query
    //     .where(
    //       and(
    //         eq(orders.state, stateParam),
    //         eq(tables.businessId, businessId)
    //       )
    //     )
    //     .orderBy(desc(orders.date), desc(orders.orderId))
    //   : await query
    //     .where(eq(tables.businessId, businessId))
    //     .orderBy(desc(orders.date), desc(orders.orderId));

    //nuevo
    const rows = await query
      .where(and(...whereConditions))
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
        discountAmount: string;
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
            discountAmount: row.detail.discountAmount,
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

//Esto es para obtener la analítica de ventas, y que se utiliza para generar el reporte de ventas con Gemini.
export const buildSalesAnalytics = async (
  businessId: number,
  period: "today" | "week" | "month" | "year",
) => {
  const now = new Date();

  let startDate: Date;
  let endDate: Date;

  if (period === "week") {
    startDate = new Date(now);

    const day = startDate.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;

    startDate.setDate(startDate.getDate() - daysFromMonday);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
  } else if (period === "month") {
    startDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );

    endDate = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    );
  } else if (period === "year") {
    startDate = new Date(
      now.getFullYear(),
      0,
      1,
      0,
      0,
      0,
      0,
    );

    endDate = new Date(
      now.getFullYear() + 1,
      0,
      1,
      0,
      0,
      0,
      0,
    );
  } else {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  }

  const [salesSummary] = await db
    .select({
      totalSales: sum(orders.total),
      totalOrders: count(orders.orderId),
    })
    .from(orders)
    .innerJoin(tables, eq(orders.tableId, tables.id))
    .where(
      and(
        eq(tables.businessId, businessId),
        eq(orders.state, orderStatuses.paid),
        gte(orders.paidAt, startDate),
        lt(orders.paidAt, endDate),
      ),
    );

  const totalSales = Number(salesSummary?.totalSales ?? 0);
  const totalOrders = Number(salesSummary?.totalOrders ?? 0);

  const averageOrder =
    totalOrders > 0 ? totalSales / totalOrders : 0;

  const [cancelledSummary] = await db
    .select({
      cancelledOrders: count(orders.orderId),
    })
    .from(orders)
    .innerJoin(tables, eq(orders.tableId, tables.id))
    .where(
      and(
        eq(tables.businessId, businessId),
        eq(orders.state, orderStatuses.cancelled),
        gte(orders.date, startDate),
        lt(orders.date, endDate),
      ),
    );

  const cancelledOrders = Number(
    cancelledSummary?.cancelledOrders ?? 0,
  );

  const [bestProduct] = await db
    .select({
      productId: products.productId,
      productName: products.productName,
      quantity: sum(orderDetails.quantity),
    })
    .from(orderDetails)
    .innerJoin(
      orders,
      eq(orderDetails.orderId, orders.orderId),
    )
    .innerJoin(
      tables,
      eq(orders.tableId, tables.id),
    )
    .innerJoin(
      products,
      eq(orderDetails.productId, products.productId),
    )
    .where(
      and(
        eq(tables.businessId, businessId),
        eq(products.businessId, businessId),
        eq(orders.state, orderStatuses.paid),
        gte(orders.paidAt, startDate),
        lt(orders.paidAt, endDate),
      ),
    )
    .groupBy(
      products.productId,
      products.productName,
    )
    .orderBy(
      desc(sum(orderDetails.quantity)),
    )
    .limit(1);

  const peakHours = await db
    .select({
      hour: sql<number>`
      EXTRACT(
        HOUR FROM ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica'
      )
    `,
      orders: count(orders.orderId),
    })
    .from(orders)
    .innerJoin(
      tables,
      eq(orders.tableId, tables.id),
    )
    .where(
      and(
        eq(tables.businessId, businessId),
        eq(orders.state, orderStatuses.paid),
        gte(orders.paidAt, startDate),
        lt(orders.paidAt, endDate),
      ),
    )
    .groupBy(
      sql`
    EXTRACT(
      HOUR FROM ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica'
    )
  `,
    )
    .orderBy(
      desc(count(orders.orderId)),
    );

  const salesByPeriod = await db
    .select({
      label:
        period === "today"
          ? sql<string>`
        TO_CHAR(
          ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
          'HH24:00'
        )
      `
          : period === "year"
            ? sql<string>`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM'
          )
        `
            : sql<string>`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM-DD'
          )
        `,
      sales: sum(orders.total),
    })
    .from(orders)
    .innerJoin(
      tables,
      eq(orders.tableId, tables.id),
    )
    .where(
      and(
        eq(tables.businessId, businessId),
        eq(orders.state, orderStatuses.paid),
        gte(orders.paidAt, startDate),
        lt(orders.paidAt, endDate),
      ),
    )
    .groupBy(
      period === "today"
        ? sql`
        TO_CHAR(
          ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
          'HH24:00'
        )
      `
        : period === "year"
          ? sql`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM'
          )
        `
          : sql`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM-DD'
          )
        `,
    )
    .orderBy(
      period === "today"
        ? sql`
        TO_CHAR(
          ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
          'HH24:00'
        )
      `
        : period === "year"
          ? sql`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM'
          )
        `
          : sql`
          TO_CHAR(
            ${orders.paidAt} AT TIME ZONE 'America/Costa_Rica',
            'YYYY-MM-DD'
          )
        `,
    );

  const totalProcessedOrders =
    totalOrders + cancelledOrders;

  const cancellationRate =
    totalProcessedOrders > 0
      ? (cancelledOrders / totalProcessedOrders) * 100
      : 0;

  return {
    period,

    dateRange: {
      start: startDate,
      end: endDate,
    },

    summary: {
      totalSales: Number(totalSales.toFixed(2)),
      totalOrders,
      averageOrder: Number(
        averageOrder.toFixed(2),
      ),
    },

    salesByPeriod: salesByPeriod.map((item) => ({
      label: item.label,
      sales: Number(item.sales ?? 0),
    })),

    bestProduct: bestProduct
      ? {
        productId: bestProduct.productId,
        name: bestProduct.productName,
        quantity: Number(
          bestProduct.quantity ?? 0,
        ),
      }
      : null,

    peakHours: peakHours.map((item) => ({
      hour: Number(item.hour),
      orders: Number(item.orders),
    })),



    cancellations: {
      total: cancelledOrders,
      rate: Number(
        cancellationRate.toFixed(2),
      ),
    },
  };
};


//Este es el controlador para obtener la analítica de ventas, que se utiliza para generar el reporte de ventas con Gemini.
export const getSalesAnalytics = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const rawPeriod = req.query.period;

    const period =
      typeof rawPeriod === "string"
        ? rawPeriod.toLowerCase()
        : "today";

    if (
      period !== "today" &&
      period !== "week" &&
      period !== "month"&&
      period !== "year"
    ) {
      return res.status(400).json({
        message: "Periodo no válido",
      });
    }

    const analytics = await buildSalesAnalytics(
      businessId,
      period,
    );

    return res.status(200).json(analytics);
  } catch (error) {
    console.error(
      "Error obteniendo analítica de ventas:",
      error,
    );

    return res.status(500).json({
      message: "No se pudo obtener la analítica de ventas",
    });
  }
};

//obtener el estado de la order
export const getOrderStatus = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "El identificador de la orden no es válido",
      });
    }

    const [order] = await db
      .select({
        orderId: orders.orderId,
        state: orders.state,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .where(eq(orders.orderId, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        message: "Orden no encontrada",
      });
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error("Error obteniendo estado de la orden:", error);

    return res.status(500).json({
      message: "No se pudo obtener el estado de la orden",
    });
  }
};

//nuevo
// Obtener la orden activa de una mesa
export const getActiveOrder = async (req: Request, res: Response) => {
  try {
    const tableId = req.params.tableId;

    if (typeof tableId !== "string") {
      return res.status(400).json({
        message: "El identificador de la mesa no es válido",
      });
    }

    const [table] = await db
      .select({
        id: tables.id,
        businessId: tables.businessId,
      })
      .from(tables)
      .where(
        and(
          eq(tables.id, tableId),
          eq(tables.active, true),
        ),
      )
      .limit(1);

    if (!table) {
      return res.status(404).json({
        message: "Mesa no encontrada o inactiva",
      });
    }


    const [activeOrder] = await db
      .select()
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

    if (!activeOrder) {
      return res.status(404).json({
        message: "No hay una orden activa para esta mesa",
      });
    }

    return res.status(200).json({
      order: activeOrder,
    });
  } catch (error) {
    console.error("Error obteniendo la orden activa:", error);

    return res.status(500).json({
      message: "No se pudo obtener la orden activa",
    });
  }
};

