import {
    integer,
    pgTable,
    serial,
    text,
    timestamp,
    unique,
    uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { orders,orderDetails} from "./orderSchema";
import { products } from "./adminMenuSchema";
import { tables } from "./mesaSchema";
import { z } from "zod";


export const reviews = pgTable(
    "reviews",
    {
        reviewId: serial("review_id").primaryKey(),

        orderId: integer("order_id")
            .notNull()
            .references(() => orders.orderId, { onDelete: "restrict" }),


            //nuevo
            orderDetailId: integer("order_detail_id")
            .notNull()
            .references(() => orderDetails.detailId, {
                onDelete: "restrict",
            }),

            

        productId: integer("product_id")
            .notNull()
            .references(() => products.productId, 
            { onDelete: "restrict" }),

        tableId: uuid("table_id")
            .notNull()
            .references(() => tables.id, { onDelete: 
                "restrict" }),

        rating: integer("rating").notNull(),

        name: text("name"),

        comment: text("comment"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        uniqueReview: unique().on(table.orderDetailId),
    }),
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
    order: one(orders, {
        fields: [reviews.orderId],
        references: [orders.orderId],
    }),
    
      orderDetail: one(orderDetails, {
    fields: [reviews.orderDetailId],
    references: [orderDetails.detailId],
  }),

    product: one(products, {
        fields: [reviews.productId],
        references: [products.productId],
    }),

    table: one(tables, {
        fields: [reviews.tableId],
        references: [tables.id],
    }),
}));

export const createReviewSchema = z.object({
    detailId: z.coerce.number().int().positive(),
    rating: z.coerce.number().int().min(1).max(5),
    name: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .nullable(),
    comment: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .nullable(),
});

export const createReviewsSchema = z.object({
    clientId: z.uuid(),
    tableId: z.uuid(),
    reviews: z.array(createReviewSchema).min(1),
});