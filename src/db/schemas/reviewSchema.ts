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
import { orders} from "./orderSchema";
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

        productId: integer("product_id")
            .notNull()
            .references(() => products.productId, { onDelete: "restrict" }),

        tableId: uuid("table_id")
            .notNull()
            .references(() => tables.id, { onDelete: "restrict" }),

        rating: integer("rating").notNull(),

        comment: text("comment"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (table) => ({
        uniqueReview: unique().on(table.orderId, table.productId),
    }),
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
    order: one(orders, {
        fields: [reviews.orderId],
        references: [orders.orderId],
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
  productId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .nullable(),
});

export const createReviewsSchema = z.object({
  tableId: z.uuid(),
  reviews: z.array(createReviewSchema).min(1),
});