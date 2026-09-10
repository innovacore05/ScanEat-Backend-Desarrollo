import { pgTable, serial, text, timestamp, boolean, integer, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";


// Define the roles table
export const roles = pgTable("roles", {
  role_id: serial("role_id").primaryKey(),
  name: text("name").notNull(),
});

// Define the pending_registrations table
export const pendingRegistrations = pgTable("pending_registrations", {
    pending_id: serial("pending_id").primaryKey(),

    first_name: varchar("first_name", { length: 100 }).notNull(),

    last_name: varchar("last_name", { length: 100 }).notNull(),

    email: varchar("email", { length: 255 }).notNull().unique(),

    password: text("password").notNull(),

    role_id: integer("role_id")
        .notNull()
        .references(() => roles.role_id, {
            onDelete: "cascade",
        }),

    code: varchar("code", { length: 10 }).notNull(),

    expires_at: timestamp("expires_at").notNull(),

    created_at: timestamp("created_at").defaultNow(),
});

// Define the users table
export const users = pgTable("users", {
  user_id: serial("user_id").primaryKey(),
  first_name: varchar("first_name", { length: 100 }).notNull(),
  last_name: varchar("last_name", { length: 100 }).notNull(),
  email: varchar("email", { length: 150 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role_id: integer("role_id").notNull().references(() => roles.role_id),
});


// Define the role_codes table
export const roleCodes = pgTable("role_codes", {
  code_id: serial("code_id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  is_active: boolean("is_active").notNull().default(true),
  role_id: integer("role_id").notNull().references(() => roles.role_id, { onDelete: "cascade" }),
});

// Define the email_verifications table
export const emailVerifications = pgTable("email_verifications", {
  verification_id: serial("verification_id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  expires_at: timestamp("expires_at").notNull(),
  verified_at: timestamp("verified_at"),
  user_id: integer("user_id").notNull().unique().references(() => users.user_id, { onDelete: "cascade" }),
});

// Define the login_verifications table
export const loginVerifications = pgTable("login_verifications", {
  otp_id:serial("otp_id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  expires_at: timestamp("expires_at").notNull(),
  verified_at: timestamp("verified_at"),
  user_id: integer("user_id").notNull().references(() => users.user_id, { onDelete: "cascade" }),
});

// Define the reset_verifications table
export const resetVerifications = pgTable("reset_verifications", {
  reset_id:serial("reset_id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  expires_at: timestamp("expires_at").notNull(),
  verified_at: timestamp("verified_at"),
  user_id: integer("user_id").notNull().references(() => users.user_id, { onDelete: "cascade" }),
});



// Define relations

// Define relations between tables
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  roleCodes: many(roleCodes),
}));

// Define relations between tables
export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, {
    fields: [users.role_id],
    references: [roles.role_id],
  }),
  verifications: many(emailVerifications),
}));

// Define relations between tables
export const roleCodesRelations = relations(roleCodes, ({ one }) => ({
  role: one(roles, {
    fields: [roleCodes.role_id],
    references: [roles.role_id],
  }),
}));

// Define relations between tables
export const emailVerificationsRelations = relations(emailVerifications, ({ one }) => ({
  user: one(users, {
    fields: [emailVerifications.user_id],
    references: [users.user_id],
  }),
}));

export const loginVerificationsRelations = relations(loginVerifications, ({ one }) => ({
  user: one(users, {
    fields: [loginVerifications.user_id],
    references: [users.user_id],
  }),
}));

export const resetVerificationsRelations = relations(resetVerifications, ({ one }) => ({
  user: one(users, {
    fields: [resetVerifications.user_id],
    references: [users.user_id],
  }),
}));


// Create Zod schemas for the users table
export const registerUserSchema = z.object({
  first_name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  last_name: z.string().min(2, "El apellido debe tener al menos 2 caracteres"),
  email: z.string().email("Formato de correo electrónico inválido"),
  password: z.string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/\d/, "La contraseña debe contener al menos un número")
  .regex(/[!@#$%^&*(),.?":{}|<>_\-\\[\]'/+=;`~]/, "La contraseña debe contener al menos un símbolo"),
  role_id: z.coerce.number().int().positive("El rol es requerido"),
  code: z
    .string()
    .trim()
    .min(1, "El código de rol es requerido")
    .transform((value) => value.toUpperCase()),
});


//Zod schema para editar los campos de informacion logeado 

export const updateUserSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracter")
    .optional(),

  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .optional(),

  email: z
    .string()
    .email("Formato de correo electrónico inválido")
    .optional(),
});

export const adminUpdateUserSchema = updateUserSchema
  .extend({
    role_id: z.coerce.number().int().positive("El rol es requerido").optional(),
  })
  .refine(
    (data) =>
      data.first_name !== undefined ||
      data.last_name !== undefined ||
      data.email !== undefined ||
      data.role_id !== undefined,
    { message: "No hay datos para actualizar" },
  );


// Create Zod schemas for the users table
export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const userParamsSchema = z.object({
  id: z.coerce.number().int().positive("El identificador de usuario no es válido"),
});

export const selectUserSchema = createSelectSchema(users);
