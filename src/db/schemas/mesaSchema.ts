import { boolean, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";

export const tables = pgTable("tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableNumber: integer("table_number").notNull().unique(),
  chairNumber: integer("chair_number").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const createTableSchema = z.object({
  tableNumber: z.coerce
    .number()
    .int("El número de mesa debe ser un entero")
    .positive("El número de mesa debe ser mayor que cero"),

  chairNumber: z.coerce
    .number()
    .int("El número de sillas debe ser un entero")
    .positive("El número de sillas debe ser mayor que cero"),
});

export const tableParamsSchema = z.object({
  id: z.uuid("El identificador de mesa no es válido"),
});
