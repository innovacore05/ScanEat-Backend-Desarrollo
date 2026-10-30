import { relations } from "drizzle-orm";
import{
     integer,
     numeric,
     pgTable,
     serial,
     text,
     timestamp,
     varchar,
     boolean,
type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { businesses,users } from "./userSchema";
import { orderDetails,orders } from "./orderSchema";
import { email } from "zod";
import {z} from "zod";


const money =(name:string)=>numeric(name,{
    precision:18,scale:5
});
const timestamptz=(name:string)=>timestamp(name,{withTimezone:true});


//datos fiscales del emisor
export const invoicingConfig=pgTable("invoicing_config",{
    configId:serial("config_id").primaryKey(),
    businessId:integer("business_id")
    .notNull()
    .unique()
    .references(()=>businesses.business_id,{onDelete:"cascade"}),
    legalId:varchar("legal_id",{length:20}).notNull(),
    legalIdType:varchar("legal_id_type",{length:2}).notNull(),
    legalName: varchar("legal_name", { length: 255 }).notNull(),
    tradeName:varchar("trade_name",{length:255}),
    activityCode:varchar("activity_code",{length:10}),
    email:varchar("email",{length:255}),
    phone:varchar("phone",{length:30}),
    address:text("address"),

// --- NUEVOS CAMPOS PARA HACIENDA ---
  province: varchar("province", { length: 2 }),
  canton: varchar("canton", { length: 2 }),
  district: varchar("district", { length: 2 }),
  neighborhood: varchar("neighborhood", { length: 50 }),
  
 
  environment: varchar("environment", { length: 15 })
  .notNull()
  .default("sandbox"),

 //regimen
      regimeKey: varchar("regime_key", { length: 30 }),
  chargesVat: boolean("charges_vat"),
  regimeVerifiedAt: timestamptz("regime_verified_at"),

  // fecha en que se subio el certificado a Factura en CR
  certificateUploadedAt: timestamptz("certificate_uploaded_at"),

  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});


//datos del supertipo en la bd que guarda todos los campos de los tipos de documentos
export const receipts=pgTable("receipts",{
    receiptId:serial("receipt_id").primaryKey(),
    businessId:integer("business_id").notNull()
    .references(()=>businesses.business_id),
    orderId:integer("order_id").notNull().references(()=>orders.orderId),
    documentType:varchar("document_type",{length:2}).notNull(),
    integratorDocumentId:varchar("integrator_document_id",{length:64}),
    clave:varchar("clave",{length:50}).unique(),
    consecutiveNumber:varchar("consecutive_number",{length:20}),
    environment:varchar("environment",{length:10}).notNull().default("sandbox"),
    situation:varchar("situation",{length:1}).notNull().default("1"),
    issueDate:timestamptz("issue_date").notNull().defaultNow(),
    saleCondition:varchar("sale_condition",{length:2}).notNull().default("01"),
currency:varchar("currency",{length:3}).notNull().default("CRC"),
recipientId:integer("recipient_id"),
observations:text("observations"),
totalSale:money("total_sale").notNull().default("0"),
totalDiscount:money("total_discount").notNull().default("0"),
totalNetSale:money("total_net_sale").notNull().default("0"),
totalTax:money("total_tax").notNull().default("0"),
totalOtherCharges:money("total_other_charges").notNull().default("0"),
totalVoucher:money("total_voucher").notNull().default("0"),
haciendaStatus:varchar("hacienda_status",{length:20})
.notNull()
.default("not_sent"),
haciendaMessage:text("hacienda_message"),
emissionAttempts:integer("emission_attempts").notNull().default(0),
lastError:text("last_error"),
replacesReceiptId:integer("replaces_receipt_id").references(():AnyPgColumn=>receipts.receiptId,),
cashierId:integer("cashier_id").notNull().references(()=>users.user_id),
createdAt:timestamptz("created_at").notNull().defaultNow(),

});


//_
export const issuerSchema = z.object({
  legalIdType: z
    .string()
    .regex(/^0[1-4]$/, "Seleccioná el tipo de identificación"),
  legalId: z
    .string()
    .regex(/^[0-9A-Za-z]{9,12}$/, "La cédula debe tener entre 9 y 12 caracteres, sin guiones"),
  legalName: z.string().trim().min(1, "Falta el nombre o razón social").max(255),
  tradeName: z.string().trim().min(1, "Falta el nombre comercial").max(255),
  activityCode: z
    .string()
    .trim()
    .regex(/^\d{4,6}(\.\d)?$/, "Actividad económica inválida (ej: 561001 o 5610.0)"),
  email: z.string().trim().email("Correo inválido").max(255),
  phone: z.string().regex(/^\d{8}$/, "El teléfono debe tener 8 dígitos"),
  province: z.string().regex(/^[1-7]$/, "La provincia debe ser un número del 1 al 7"),
  canton: z.string().regex(/^\d{2}$/, "El cantón debe tener 2 dígitos (ej: 01)"),
  district: z.string().regex(/^\d{2}$/, "El distrito debe tener 2 dígitos (ej: 01)"),
  neighborhood: z.string().trim().max(50, "El barrio es muy largo").optional().default(""),
  address: z
    .string()
    .trim()
    .min(5, "La dirección exacta debe tener al menos 5 caracteres")
    .max(250),
  environment: z.string().regex(/^(sandbox|production)$/, "Ambiente inválido"),
});

//detalles del recivo

export const receiptDetails = pgTable("receipt_details", {
  detailId: serial("detail_id").primaryKey(),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.receiptId, { onDelete: "cascade" }),
  orderDetailId: integer("order_detail_id").references(
    () => orderDetails.detailId,
    { onDelete: "set null" },
  ),
  lineNumber: integer("line_number").notNull(),
  cabysCode: varchar("cabys_code", { length: 13 }).notNull(),
  detail: text("detail").notNull(),
  quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
  unitMeasure: varchar("unit_measure", { length: 15 }).notNull().default("Unid"),
  unitPrice: money("unit_price").notNull(),
  discountAmount: money("discount_amount").notNull().default("0"),
  discountCode: varchar("discount_code", { length: 2 }),
  discountNature: varchar("discount_nature", { length: 80 }),
  subtotal: money("subtotal").notNull(),
  taxAmount: money("tax_amount").notNull().default("0"),
  lineTotal: money("line_total").notNull(),
});
 //impuesto 
export const receiptTaxes = pgTable("receipt_taxes", {
  taxId: serial("tax_id").primaryKey(),
  detailId: integer("detail_id")
    .notNull()
    .references(() => receiptDetails.detailId, { onDelete: "cascade" }),
  taxCode: varchar("tax_code", { length: 2 }).notNull().default("01"),
  taxRateCode: varchar("tax_rate_code", { length: 2 }).notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
  amount: money("amount").notNull().default("0"),
});
 
 
// Otros cargos: servicio 10% = charge_type 06
export const otherCharges = pgTable("other_charges", {
  chargeId: serial("charge_id").primaryKey(),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.receiptId, { onDelete: "cascade" }),
  chargeType: varchar("charge_type", { length: 2 }).notNull().default("06"),
  detail: text("detail").notNull().default("Impuesto de servicio"),
  percentage: numeric("percentage", { precision: 5, scale: 2 }),
  amount: money("amount").notNull(),
});

// method: 01 efectivo, 02 tarjeta, 06 SINPE
export const payments = pgTable("payments", {
  paymentId: serial("payment_id").primaryKey(),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.receiptId),
  method: varchar("method", { length: 2 }).notNull(),
  reference: varchar("reference", { length: 50 }),
  amount: money("amount").notNull(),
  amountTendered: money("amount_tendered"),
  changeGiven: money("change_given"),
  cashierId: integer("cashier_id")
    .notNull()
    .references(() => users.user_id),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
 
// receiptId = la nota; referencedReceiptId = el comprobante que corrige
export const documentReferences = pgTable("document_references", {
  referenceId: serial("reference_id").primaryKey(),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.receiptId, { onDelete: "cascade" }),
  referencedReceiptId: integer("referenced_receipt_id").references(
    () => receipts.receiptId,
  ),
  documentType: varchar("document_type", { length: 2 }).notNull().default("04"),
  referencedClave: varchar("referenced_clave", { length: 50 }).notNull(),
  issueDate: timestamptz("issue_date").notNull(),
  code: varchar("code", { length: 2 }).notNull().default("01"),
  reason: text("reason"),
});
 
export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  order: one(orders, {
    fields: [receipts.orderId],
    references: [orders.orderId],
  }),
  details: many(receiptDetails),
  otherCharges: many(otherCharges),
  payments: many(payments),
}));
 
export const receiptDetailsRelations = relations(
  receiptDetails,
  ({ one, many }) => ({
    receipt: one(receipts, {
      fields: [receiptDetails.receiptId],
      references: [receipts.receiptId],
    }),
    taxes: many(receiptTaxes),
  }),
);
 export const receiptTaxesRelations = relations(receiptTaxes, ({ one }) => ({
  detail: one(receiptDetails, {
    fields: [receiptTaxes.detailId],
    references: [receiptDetails.detailId],
  }),
}));
 
export const otherChargesRelations = relations(otherCharges, ({ one }) => ({
  receipt: one(receipts, {
    fields: [otherCharges.receiptId],
    references: [receipts.receiptId],
  }),
}));
 
export const paymentsRelations = relations(payments, ({ one }) => ({
  receipt: one(receipts, {
    fields: [payments.receiptId],
    references: [receipts.receiptId],
  }),
}));
 
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptDetail = typeof receiptDetails.$inferSelect;
export type Payment = typeof payments.$inferSelect;