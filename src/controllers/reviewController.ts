import { Request, Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection";
import { createReviewsSchema, reviews } from "../db/schemas/reviewSchema";
import { tables } from "../db/schemas/mesaSchema";
import { orderDetails, orders, orderStatuses } from "../db/schemas/orderSchema";
import { products } from "../db/schemas/adminMenuSchema";
import { AuthRequest } from "../middleware/authenticate";

const getOrderId = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const orderId = Number(value);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return null;
  }

  return orderId;
};

const getTableIdFromQuery = (value: unknown) => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Obtiene los productos de un pedido que pueden ser reseñados.
 *
 * GET /api/reviews/orders/:orderId?tableId=uuid
 */
export const getOrderReviewItems = async (req: Request, res: Response) => {

 
    try {
    const orderId = getOrderId(req.params.orderId);
    const tableId = getTableIdFromQuery(req.query.tableId);
    const clientIdParsed = z.uuid().safeParse(req.query.clientId);

    if (!orderId) {
      return res.status(400).json({
        message: "El identificador del pedido no es válido",
      });
    }

    if (!tableId) {
      return res.status(400).json({
        message: "El identificador de mesa no es válido",
      });
    }

    if (!clientIdParsed.success) {
  return res.status(400).json({ message: "El identificador de dispositivo no es válido" });
}
const clientId = clientIdParsed.data;

    const [order] = await db
      .select({
        orderId: orders.orderId,
        state: orders.state,
        tableId: orders.tableId,
        businessId: tables.businessId,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .where(eq(orders.orderId, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        message: "Pedido no encontrado",
      });
    }

    if (order.tableId !== tableId) {
      return res.status(403).json({
        message: "El pedido no pertenece a esta mesa",
      });
    }

    const [table] = await db
      .select({
        id: tables.id,
        businessId: tables.businessId,
      })
      .from(tables)
      .where(and(eq(tables.id, tableId), eq(tables.active, true)))
      .limit(1);

    if (!table) {
      return res.status(404).json({
        message: "Mesa no encontrada o inactiva",
      });
    }

    if (table.businessId !== order.businessId) {
      return res.status(403).json({
        message: "La mesa no pertenece al mismo negocio del pedido",
      });
    }

    if (order.state !== orderStatuses.delivered) {
      return res.status(409).json({
        message: "Solo puedes reseñar pedidos entregados",
      });
    }

    const items = await db
      .select({
        detailId: orderDetails.detailId,
        productId: products.productId,
        productName: products.productName,
        reviewed: reviews.reviewId,
      })
      .from(orderDetails)
      .innerJoin(
        products,
        and(
          eq(orderDetails.productId, products.productId),
          eq(products.businessId, order.businessId),
        ),
      )
      .leftJoin(reviews, eq(reviews.orderDetailId, orderDetails.detailId))
      .where(
  and(
    eq(orderDetails.orderId, orderId),
    eq(orderDetails.clientId, clientId),
  ),
);

    return res.status(200).json({
      orderId,
      state: order.state,
      products: items.map((item) => ({
        detailId: item.detailId,
        productId: item.productId,
        productName: item.productName,
        reviewed: item.reviewed !== null,
      })),
    });
  } catch (error) {
    console.error("Error obteniendo productos reseñables:", error);

    return res.status(500).json({
      message: "No se pudieron obtener los productos del pedido",
    });
  }
};

/**
 * Guarda una o varias reseñas de un pedido.
 *
 * POST /api/reviews/orders/:orderId
 */
export const createReviews = async (req: Request, res: Response) => {
  try {
    const orderId = getOrderId(req.params.orderId);

    if (!orderId) {
      return res.status(400).json({
        message: "El identificador del pedido no es válido",
      });
    }

    const parsed = createReviewsSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Los datos de las reseñas no son válidos",
        errors: parsed.error.flatten(),
      });
    }

    const { tableId, clientId, reviews: reviewItems } = parsed.data;

    // const productIds = reviewItems.map((review) => review.productId);

    // if (new Set(productIds).size !== productIds.length) {
    //     return res.status(400).json({
    //         message: "No puedes enviar más de una reseña para el mismo producto",
    //     });
    // }

    //nuevo
    const detailIds = reviewItems.map((review) => review.detailId);

    if (new Set(detailIds).size !== detailIds.length) {
      return res.status(400).json({
        message:
          "No puedes enviar más de una reseña para el mismo comentario del pedido",
      });
    }

    const [order] = await db
      .select({
        orderId: orders.orderId,
        state: orders.state,
        tableId: orders.tableId,
        businessId: tables.businessId,
      })
      .from(orders)
      .innerJoin(tables, eq(orders.tableId, tables.id))
      .where(eq(orders.orderId, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        message: "Pedido no encontrado",
      });
    }

    if (order.tableId !== tableId) {
      return res.status(403).json({
        message: "El pedido no pertenece a esta mesa",
      });
    }

    const [table] = await db
      .select({
        id: tables.id,
        businessId: tables.businessId,
      })
      .from(tables)
      .where(and(eq(tables.id, tableId), eq(tables.active, true)))
      .limit(1);

    if (!table) {
      return res.status(404).json({
        message: "Mesa no encontrada o inactiva",
      });
    }

    if (table.businessId !== order.businessId) {
      return res.status(403).json({
        message: "La mesa no pertenece al mismo negocio del pedido",
      });
    }

    if (order.state !== orderStatuses.delivered) {
      return res.status(409).json({
        message: "Solo puedes reseñar pedidos entregados",
      });
    }

    const orderItems = await db
      .select({
        detailId: orderDetails.detailId,
        productId: orderDetails.productId,
      })
      .from(orderDetails)
      .innerJoin(
        products,
        and(
          eq(orderDetails.productId, products.productId),
          eq(products.businessId, order.businessId),
        ),
      )
     .where(
  and(
    eq(orderDetails.orderId, orderId),
    eq(orderDetails.clientId, clientId),
    inArray(orderDetails.detailId, detailIds),
  ),
);
    const purchasedDetailIds = new Set(orderItems.map((item) => item.detailId));

    const invalidDetail = detailIds.find(
      (detailId) => !purchasedDetailIds.has(detailId),
    );

    if (invalidDetail) {
      return res.status(400).json({
        message: `El detalle ${invalidDetail} no pertenece a este pedido`,
      });
    }

    const existingReviews = await db
      .select({
        orderDetailId: reviews.orderDetailId,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.orderId, orderId),
          inArray(reviews.orderDetailId, detailIds),
        ),
      );

    if (existingReviews.length > 0) {
      return res.status(409).json({
        message: "Uno o más productos ya tienen una reseña en este pedido",
      });
    }

    await db.insert(reviews).values(
      reviewItems.map((review) => {
        const orderItem = orderItems.find(
          (item) => item.detailId === review.detailId,
        );
        return {
          orderId,
          orderDetailId: review.detailId,
          productId: orderItem!.productId,
          tableId: order.tableId,
          rating: review.rating,
          name: review.name || null,
          comment: review.comment || null,
        };
      }),
    );

    return res.status(201).json({
      message: "Reseñas guardadas correctamente",
    });
  } catch (error) {
    console.error("Error guardando reseñas:", error);

    return res.status(500).json({
      message: "No se pudieron guardar las reseñas",
    });
  }
};

/**
 * Obtiene las reseñas públicas de un producto.
 *
 * GET /api/reviews/products/:productId
 */
export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        message: "El identificador del producto no es válido",
      });
    }

    const [product] = await db
      .select({
        productId: products.productId,
        productName: products.productName,
      })
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);

    if (!product) {
      return res.status(404).json({
        message: "Producto no encontrado",
      });
    }

    const productReviews = await db
      .select({
        reviewId: reviews.reviewId,
        rating: reviews.rating,
        name: reviews.name,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(eq(reviews.productId, productId))
      .orderBy(desc(reviews.createdAt));

    const [summary] = await db
      .select({
        averageRating: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
        totalReviews: sql<string>`COUNT(${reviews.reviewId})`,
      })
      .from(reviews)
      .where(eq(reviews.productId, productId));

    return res.status(200).json({
      productId: product.productId,
      productName: product.productName,
      averageRating: Number(summary?.averageRating ?? 0),
      totalReviews: Number(summary?.totalReviews ?? 0),
      reviews: productReviews,
    });
  } catch (error) {
    console.error("Error obteniendo reseñas del producto:", error);

    return res.status(500).json({
      message: "No se pudieron obtener las reseñas del producto",
    });
  }
};

export const deleteReview = async (req: AuthRequest, res: Response) => {
  try {
    const reviewId = Number(req.params.reviewId);
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      return res.status(400).json({
        message: "El ID de la reseña no es válida",
      });
    }

    const [existingReview] = await db
      .select({ reviewId: reviews.reviewId })
      .from(reviews)
      .innerJoin(products, eq(reviews.productId, products.productId))
      .where(
        and(
          eq(reviews.reviewId, reviewId),
          eq(products.businessId, businessId),
        ),
      )
      .limit(1);

    if (!existingReview) {
      return res.status(404).json({
        message: "Reseña no encontrada",
      });
    }

    await db.delete(reviews).where(eq(reviews.reviewId, reviewId));

    return res.status(200).json({
      message: "Reseña eliminada correctamente",
    });
  } catch (error) {
    console.error("Error eliminando reseña:", error);

    return res.status(500).json({
      message: "No se pudo eliminar la reseña",
    });
  }
};
