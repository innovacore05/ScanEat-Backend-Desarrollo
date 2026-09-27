import {
  integer,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { businesses } from "./userSchema";

export const restaurantThemes = pgTable("restaurant_themes", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),

  businessId: integer("business_id")
    .notNull()
    .unique()
    .references(() => businesses.business_id, {
      onDelete: "cascade",
    }),

  primaryColor: varchar("primary_color", { length: 7 }).notNull(),
  secondaryColor: varchar("secondary_color", { length: 7 }).notNull(),
  fontFamily: varchar("font_family", { length: 50 }).notNull(),
  logoUrl: varchar("logo_url", { length: 500 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const DEFAULT_THEME = {
  primaryColor: "#61AD9E",
  secondaryColor: "#2C7667",
  fontFamily: "Lato",
  logoUrl: null,
} as const;

export const restaurantFontSchema = z.enum([
  "Lato",
  "Inter",
  "Poppins",
  "Roboto",
  "Montserrat",
  "Playfair Display",
]);

export const hexColorSchema = z.string().regex(
  /^#[0-9A-Fa-f]{6}$/,
  "El color debe tener el formato #RRGGBB",
);

export const updateRestaurantThemeSchema = z.object({
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  fontFamily: restaurantFontSchema,
  logoUrl: z.string().url().nullable(),
});