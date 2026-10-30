import { and, eq, sql } from "drizzle-orm";
import db from "../db/connection";
import { invoicingConfig, receipts } from "../db/schemas/billingSchema";
import {
  TiquetePayloadBuilder,
  type PaymentMethod,
} from "./payloadBulder.service";

const BASE_URL = "https://api.facturaencr.com/v2/efactura";
const TIMEOUT_MS = 20_000;

// solo estos dos estados son finales; todo lo demás es "en vuelo"
export const FINAL_STATUSES = new Set(["accepted", "rejected"]);

type IssuerRow = typeof invoicingConfig.$inferSelect;


export type EmitTiqueteResult =
  | { ok: true; receipt: typeof receipts.$inferSelect }
  | {
      ok: false;
      status: number | null;
      code?: string;
      message: string;
      retryAfterSeconds?: number;
    };

export class FacturaEnCrError extends Error {
  constructor(
     message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

// cliente HTTP: credenciales solo del servidor, timeout y errores uniformes
const request = async <T>(
  path: string,
  options: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<T> => {
  const apiKey = process.env.FACTURAENCR_API_KEY;
  const apiSecret = process.env.FACTURAENCR_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("Faltan las credenciales de Factura en CR en el servidor");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method,
    headers: {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret,
      Accept: "application/json",
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
  const retryAfterSeconds =
    typeof data?.retryAfterSeconds === "number"
      ? data.retryAfterSeconds
      : undefined;

  throw new FacturaEnCrError(
    data?.message ?? `Factura en CR respondió ${response.status}`,
    response.status,
    data?.error,
    data?.details,
    retryAfterSeconds,
  );
}

  return data as T;
};


//regimen
type RegimeResponse = {
  // TODO: confirmar en sandbox si viene envuelto en "regimen" o en la raíz
  regimen?: { clave?: string; trasladaIva?: boolean };
};

export const fetchRegime = async (legalId: string) => {
  const data = await request<RegimeResponse>(
    `/contribuyentes/${encodeURIComponent(legalId)}/regimen?refresh=true`,
    { method: "GET" },
  );

  const regimen = data.regimen;
  if (!regimen || typeof regimen.trasladaIva !== "boolean") return null;

  return { key: regimen.clave ?? null, chargesVat: regimen.trasladaIva };
};


// ---------- emisión ----------

type EmissionLine = {
  detail: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  subtotal: string;
  tax: string;
  cabysCode: string;
  ivaRate: string;
  ivaRateCode: string;
};

type EmissionResponse = {
  documentId: string;
  clave: string;
  consecutivo: string;
  status: string;
  environment: string;
};

// se llama DESPUÉS del commit del cobro; un fallo aquí nunca deshace el pago
export const emitTiquete = async (
  params: {
    receiptId: number;
    orderId: number;
    issuer: IssuerRow;
    lines: EmissionLine[];
    total: string;
    serviceCharge: string;
    chargesVat: boolean;
    paymentMethod: PaymentMethod;
    substituteKey?: string;
  },
): Promise<EmitTiqueteResult> => {

  try {
    // si el builder lanza error, cae al catch: no se envía nada
    const payload = {
      ...TiquetePayloadBuilder.build({
        emisorLegalId: params.issuer.legalId,
        sustituye: params.substituteKey,
        paymentMethod: params.paymentMethod,
        
        total: params.total,
        serviceCharge: params.serviceCharge,
        chargesVat: params.chargesVat,
        lines: params.lines.map((line) => ({ ...line, discountCode: "07" })),
      }),
      environment: params.issuer.environment,
      observaciones: `Orden #${params.orderId}`,
    };

    const result = await request<EmissionResponse>("/documents/tiquete", {
      method: "POST",
      body: payload,
      // estable por recibo: un reintento no duplica el documento
      idempotencyKey: `receipt-${params.receiptId}`,
    });

    const [updated] = await db
      .update(receipts)
      .set({
        integratorDocumentId: result.documentId,
        clave: result.clave,
        consecutiveNumber: result.consecutivo,
        environment: result.environment,
        haciendaStatus: result.status,
        emissionAttempts: sql`${receipts.emissionAttempts} + 1`,
        lastError: null,
      })
      .where(eq(receipts.receiptId, params.receiptId))
      .returning();

    return { ok: true, receipt: updated };
  } catch (error) {
    const message =
      error instanceof FacturaEnCrError
        ? `${error.code ?? error.status}: ${error.message} ${JSON.stringify(error.details ?? "")}`
        : error instanceof Error
          ? error.message
          : "Error desconocido";

    console.error("Error emitiendo el tiquete:", message);

    await db
      .update(receipts)
      .set({
        emissionAttempts: sql`${receipts.emissionAttempts} + 1`,
        lastError: message.slice(0, 1000),
      })
      .where(eq(receipts.receiptId, params.receiptId));
//
   return {
  ok: false,
  status: error instanceof FacturaEnCrError ? error.status : null,
  code: error instanceof FacturaEnCrError ? error.code : undefined,
  message,
  ...(error instanceof FacturaEnCrError &&
  error.retryAfterSeconds !== undefined
    ? { retryAfterSeconds: error.retryAfterSeconds }
    : {}),
};
  }
};

// ---------- consulta de estado (polling) ----------

type DocumentResponse = { status: string; haciendaMessage?: string | null };

export const refreshReceiptStatus = async (
  receiptId: number,
  businessId: number,
) => {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(
      and(eq(receipts.receiptId, receiptId), eq(receipts.businessId, businessId)),
    )
    .limit(1);

  if (!receipt) return null;
  if (!receipt.integratorDocumentId || FINAL_STATUSES.has(receipt.haciendaStatus)) {
    return receipt;
  }

  const doc = await request<DocumentResponse>(
    `/documents/${receipt.integratorDocumentId}`,
    { method: "GET" },
  );

  const [updated] = await db
    .update(receipts)
    .set({
      haciendaStatus: doc.status,
      haciendaMessage: doc.haciendaMessage ?? null,
    })
    .where(eq(receipts.receiptId, receiptId))
    .returning();

  return updated;
};