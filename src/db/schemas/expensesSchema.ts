
import { relations } from "drizzle-orm";
import {
    pgTable,
    serial,
    varchar,
    numeric,
    timestamp,
    integer,
    text,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { businesses } from "./userSchema";

export const expenses = pgTable("expenses", {
    expense_id: serial("expense_id").primaryKey(),

    motive: varchar("motive", { length: 255 }).notNull(),

    amount: numeric("amount", {
        precision: 10,
        scale: 2,
    }).notNull(),

    supplier: varchar("supplier", { length: 150 }).notNull(),

    date: timestamp("date").notNull().defaultNow(),


    observations: text("observations"),

    invoice_key: varchar("invoice_key", { length: 500 }),

    business_id: integer("business_id")
        .notNull()
        .references(() => businesses.business_id, {
            onDelete: "cascade",
        }),


    created_at: timestamp("created_at").notNull().defaultNow(),
});

export const expensesRelations = relations(expenses, ({ one }) => ({
    business: one(businesses, {
        fields: [expenses.business_id],
        references: [businesses.business_id],
    }),
}));

export const createExpenseSchema = z.object({
    motive: z.string().trim().min(2, "El motivo es obligatorio").max(255),
    amount: z.coerce.number().positive("El monto debe ser mayor que cero"),
    supplier: z.string().trim().min(2, "El proveedor es obligatorio").max(150),
    date: z.coerce.date(),
    observations: z.string().trim().max(1000).optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
