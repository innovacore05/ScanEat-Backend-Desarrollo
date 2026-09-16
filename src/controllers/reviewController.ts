import { Request, Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection";
import {
    createReviewsSchema,
    reviews,
} from "../db/schemas/reviewSchema";
import {
    orderDetails,
    orders,
    orderStatuses,
} from "../db/schemas/orderSchema";
import { products } from "../db/schemas/adminMenuSchema";

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
export const getOrderReviewItems = async (
    req: Request,
    res: Response,
) => {
    try {
        const orderId = getOrderId(req.params.orderId);
        const tableId = getTableIdFromQuery(req.query.tableId);

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

        const [order] = await db
            .select({
                orderId: orders.orderId,
                state: orders.state,
                tableId: orders.tableId,
            })
            .from(orders)
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

        if (order.state !== orderStatuses.delivered) {
            return res.status(409).json({
                message: "Solo puedes reseñar pedidos entregados",
            });
        }

        const items = await db
            .select({
                productId: products.productId,
                productName: products.productName,
                reviewed: reviews.reviewId,
            })
            .from(orderDetails)
            .innerJoin(
                products,
                eq(orderDetails.productId, products.productId),
            )
            .leftJoin(
                reviews,
                and(
                    eq(reviews.orderId, orderId),
                    eq(reviews.productId, products.productId),
                ),
            )
            .where(eq(orderDetails.orderId, orderId));

        return res.status(200).json({
            orderId,
            state: order.state,
            products: items.map((item) => ({
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
export const createReviews = async (
    req: Request,
    res: Response,
) => {
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

        const { tableId, reviews: reviewItems } = parsed.data;

        const productIds = reviewItems.map((review) => review.productId);

        if (new Set(productIds).size !== productIds.length) {
            return res.status(400).json({
                message: "No puedes enviar más de una reseña para el mismo producto",
            });
        }

        const [order] = await db
            .select({
                orderId: orders.orderId,
                state: orders.state,
                tableId: orders.tableId,
            })
            .from(orders)
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

        if (order.state !== orderStatuses.delivered) {
            return res.status(409).json({
                message: "Solo puedes reseñar pedidos entregados",
            });
        }

        const orderItems = await db
            .select({
                productId: orderDetails.productId,
            })
            .from(orderDetails)
            .where(
                and(
                    eq(orderDetails.orderId, orderId),
                    inArray(orderDetails.productId, productIds),
                ),
            );

        const purchasedProductIds = new Set(
            orderItems.map((item) => item.productId),
        );

        const invalidProduct = productIds.find(
            (productId) => !purchasedProductIds.has(productId),
        );

        if (invalidProduct) {
            return res.status(400).json({
                message: `El producto ${invalidProduct} no pertenece a este pedido`,
            });
        }

        const existingReviews = await db
            .select({
                productId: reviews.productId,
            })
            .from(reviews)
            .where(
                and(
                    eq(reviews.orderId, orderId),
                    inArray(reviews.productId, productIds),
                ),
            );

        if (existingReviews.length > 0) {
            return res.status(409).json({
                message: "Uno o más productos ya tienen una reseña en este pedido",
            });
        }

        await db.insert(reviews).values(
            reviewItems.map((review) => ({
                orderId,
                productId: review.productId,
                tableId: order.tableId,
                rating: review.rating,
                comment: review.comment || null,
            })),
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
export const getProductReviews = async (
    req: Request,
    res: Response,
) => {
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
                rating: reviews.rating,
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