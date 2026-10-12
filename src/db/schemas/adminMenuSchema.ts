import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  varchar,
  numeric,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";


export const FISCAL_TYPES=
[
  "dishes",
  "hot_drinks",
  "cold_drinks",
  "alcohol_drinks",
  "packaged",
  
] as const;

export type FiscalType=(typeof FISCAL_TYPES)[number];


export const categories = pgTable("categories", {
  categoryId: serial("category_id").primaryKey(),
  name: varchar("name", {length: 100,}).notNull(),
  icon: varchar("icon", {length: 100, }),
  fiscalType:varchar("fiscal_type",{length:20}).$type<FiscalType>(),
  businessId: integer("business_id").notNull(),
});


export type FiscalOptionType = FiscalType;

export const fiscalOptions = pgTable("fiscal_options", {
  cabysCode: varchar("cabys_code", { length: 13 }).primaryKey(),
  fiscalType: varchar("fiscal_type", { length: 20 })
    .$type<FiscalOptionType>()
    .notNull(),
  label: varchar("label", { length: 150 }).notNull(),
  groupName: varchar("group_name", { length: 100 }),
  ivaRate: numeric("iva_rate", { precision: 4, scale: 2 }).notNull(),
  ivaRateCode: varchar("iva_rate_code", { length: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
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
    cabysCode:varchar("cabys_code",{length:13}),
    ivaRateCode: varchar("iva_rate_code", { length: 2 })
    .notNull()
    .default("08"),
  ivaRate: numeric("iva_rate", { precision: 4, scale: 2 })
    .notNull()
    .default("13.00"),
  isCustom: integer("is_custom").default(0),
  businessId: integer("business_id").notNull(),
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

//neevo
export const insertFiscalOptionSchema = createInsertSchema(fiscalOptions);
export const selectFiscalOptionSchema = createSelectSchema(fiscalOptions);

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
 discount: z.coerce
  .number()
  .min(0, "El descuento no puede ser negativo")
  .max(100, "El descuento no puede superar el 100 %")
  .optional(),
    cabysCode: z
    .string()
    .regex(/^\d{13}$/, "El CABYS debe tener 13 dígitos")
    .optional(),
});

const optionGroupSchema = z.object({
  name: z.string().trim().min(1, "Todos los grupos de opciones deben tener un nombre"),
  options: z
    .array(z.string().trim().min(1, "Todas las opciones deben tener un valor"))
    .min(1, "Todos los grupos de opciones deben tener al menos una opción"),
});

export const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  icon: z.string().min(1, "El ícono es obligatorio"),
  fiscalType:z.enum(FISCAL_TYPES),
});

export const createProductSchema = baseDishSchema;
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const createCustomDishSchema = baseDishSchema.extend({
  optionGroups: z.array(optionGroupSchema).min(1, "Ingresa al menos un grupo de opciones"),
});
export type CreateCustomDishInput = z.infer<typeof createCustomDishSchema>;