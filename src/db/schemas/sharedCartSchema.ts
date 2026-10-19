import { sql } from "drizzle-orm";
import {
  index,
  integer,
  json,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { products } from "./adminMenuSchema";
import { tables } from "./mesaSchema";
import { orders } from "./orderSchema";

export const sharedCarts = pgTable(
  "shared_carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    observation: text("observation"),
    orderId: integer("order_id").references(() => orders.orderId),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shared_carts_one_open_per_table")
      .on(t.tableId)
      .where(sql`${t.status} = 'open'`),
  ],
);

export const sharedCartItems = pgTable(
  "shared_cart_items",
  {
    id: serial("id").primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => sharedCarts.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    quantity: integer("quantity").notNull(),
    selectedOptions: json("selected_options")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shared_cart_items_cart_idx").on(t.cartId)],
);