import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { numeric } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  categoryId: serial("category_id").primaryKey(),
  name: varchar("name", {
    length: 100,
  }).notNull(),
});

export const products = pgTable("products", {
  productId: serial("product_id").primaryKey(),
  productName: varchar("product_name", { length: 225 }).notNull(),
  image: varchar("image", { length: 225 }),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  rating: numeric("rating", { precision: 2, scale: 1 }).default("0.0"),
  discount: numeric("discount", { precision: 5, scale: 2 }).default("0.00"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.categoryId),
  isCustom: integer("is_custom").default(0),
});

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.categoryId],
  }),
  modifierGroups: many(modifierGroups),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));


//NUEVO//CUSTOMDISH
//platillo personalizado

export const modifierGroups = pgTable("modifier_groups", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.productId, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
});

export const modifierOptions = pgTable("modifier_options", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
});

export const modifierGroupRelations = relations(
  modifierGroups,
  ({ one, many }) => ({
    product: one(products, {
      fields: [modifierGroups.productId],
      references: [products.productId],
    }),
    options: many(modifierOptions),
  }),
);

export const modifierOptionsRelations = relations(
  modifierOptions,
  ({ one }) => ({
    group: one(modifierGroups, {
      fields: [modifierOptions.groupId],
      references: [modifierGroups.id],
    }),
  }),
);

//zod schema

export const insertCategorySchema = createInsertSchema(categories);
export const selectCategorySchema = createSelectSchema(categories);
export const insertProductSchema = createInsertSchema(products);
export const selectProductSchema = createSelectSchema(products);

export const menuSearchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});

//schemas de productos

const baseDishSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  description: z.string().min(1, "La descripción es obligatoria"),
  price: z.coerce.number().positive("Ingresa un precio válido"),
  categoryId: z.coerce.number().int().positive("Selecciona una categoría"),
  discount: z.coerce.number().min(0).optional(),
});

const optionGroupSchema = z.object({
  name: z.string().trim().min(1, "Todos los grupos de opciones deben tener un nombre"),
  options: z
    .array(z.string().trim().min(1, "Todas las opciones deben tener un valor"))
    .min(1, "Todos los grupos de opciones deben tener al menos una opción"),
});

export const createProductSchema = baseDishSchema;
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const createCustomDishSchema = baseDishSchema.extend({
  optionGroups: z.array(optionGroupSchema).min(1, "Ingresa al menos un grupo de opciones"),
});
export type CreateCustomDishInput = z.infer<typeof createCustomDishSchema>;