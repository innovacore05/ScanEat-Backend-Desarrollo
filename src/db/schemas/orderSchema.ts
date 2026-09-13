import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { products } from "./adminMenuSchema";
import { tables } from "./mesaSchema";

export const orders = pgTable("orders", {
  orderId: serial("order_id").primaryKey(),
  date: timestamp("date").notNull().defaultNow(),
  state: varchar("state", { length: 20 }).notNull().default("pending"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tax: numeric("tax", { precision: 10, scale: 2 }).notNull().default("0.00"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0.00"),
  observation: text("observation"),
  tableId: uuid("table_id")
    .notNull()
    .references(() => tables.id),
});

export const orderDetails = pgTable("order_details", {
  detailId: serial("detail_id").primaryKey(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  selectedOptions: jsonb("selected_options")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.orderId, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.productId),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  details: many(orderDetails),
}));

export const orderDetailsRelations = relations(orderDetails, ({ one }) => ({
  order: one(orders, {
    fields: [orderDetails.orderId],
    references: [orders.orderId],
  }),
  product: one(products, {
    fields: [orderDetails.productId],
    references: [products.productId],
  }),
}));

const orderItemSchema = z.object({
  productId: z.coerce.number().int().positive("El producto no es válido"),
  quantity: z.coerce.number().int().positive("La cantidad debe ser mayor que cero"),
  selectedOptions: z.record(z.string(), z.string()).optional().default({}),
});

export const createOrderSchema = z
  .object({
    tableId: z.uuid("El identificador de mesa no es válido"),
    observation: z.string().trim().max(1000, "La observación es demasiado larga").optional(),
    items: z.array(orderItemSchema).min(1, "El pedido debe incluir al menos un producto"),
  })
  .superRefine((order, context) => {
    const productIds = order.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "No se puede repetir un producto; ajusta su cantidad",
      });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
