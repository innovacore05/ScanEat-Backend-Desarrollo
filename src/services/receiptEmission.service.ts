import { and, asc, eq } from "drizzle-orm";

import db from "../db/connection";
import {
  invoicingConfig,
  otherCharges,
  payments,
  receiptDetails,
  receiptTaxes,
  receipts,
} from "../db/schemas/billingSchema";
import { emitTiquete } from "./factura.service";

export type QueueEmissionResult =
  | { ok: true }
  | {
      ok: false;
      retryable: boolean;
      message: string;
      retryAfterSeconds?: number;
    };

const permanentFailure = (message: string): QueueEmissionResult => ({
  ok: false,
  retryable: false,
  message,
});

export async function emitReceiptForQueue(
  receiptId: number,
): Promise<QueueEmissionResult> {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.receiptId, receiptId))
    .limit(1);

  if (!receipt) {
    return permanentFailure("No se encontró el recibo");
  }

  // Si una petición anterior sí llegó a crear el documento, no lo emitimos otra vez.
  if (receipt.integratorDocumentId) {
    return { ok: true };
  }

 if (
  receipt.haciendaStatus !== "not_sent" &&
  receipt.haciendaStatus !== "pending"
) {
  return permanentFailure(
    `El recibo no está pendiente de emisión: ${receipt.haciendaStatus}`,
  );
}

  if (receipt.documentType !== "04") {
    return permanentFailure("Solo se pueden emitir tiquetes desde esta cola");
  }

  let substituteKey: string | undefined;

  if (receipt.replacesReceiptId !== null) {
    const [original] = await db
      .select({
        documentType: receipts.documentType,
        haciendaStatus: receipts.haciendaStatus,
        clave: receipts.clave,
      })
      .from(receipts)
      .where(
        and(
          eq(receipts.receiptId, receipt.replacesReceiptId),
          eq(receipts.businessId, receipt.businessId),
        ),
      )
      .limit(1);

    if (
      !original ||
      original.documentType !== "04" ||
      original.haciendaStatus !== "rejected" ||
      !original.clave
    ) {
      return permanentFailure(
        "No se pudo validar el tiquete original del reemplazo",
      );
    }

    substituteKey = original.clave;
  }

  // La API conserva la idempotencia 24 horas; dejamos una hora de margen.
  const safeRetryWindowMs = 23 * 60 * 60 * 1000;

  if (Date.now() - receipt.createdAt.getTime() >= safeRetryWindowMs) {
    return permanentFailure(
      "Venció el plazo seguro para reintentar. Verifica el recibo con Facturaencr antes de emitirlo otra vez.",
    );
  }

  const [issuer] = await db
    .select()
    .from(invoicingConfig)
    .where(eq(invoicingConfig.businessId, receipt.businessId))
    .limit(1);

  if (!issuer || !issuer.certificateUploadedAt) {
    return permanentFailure("El emisor no tiene un certificado cargado");
  }

  if (
    issuer.environment !== receipt.environment ||
    issuer.updatedAt > receipt.createdAt
  ) {
    return permanentFailure(
      "Los datos o el ambiente del emisor cambiaron desde el cobro. Verifica la emisión antes de reintentar.",
    );
  }

  const savedLines = await db
    .select({
      detail: receiptDetails,
      taxCode: receiptTaxes.taxCode,
      taxRateCode: receiptTaxes.taxRateCode,
      taxRate: receiptTaxes.taxRate,
    })
    .from(receiptDetails)
    .innerJoin(
      receiptTaxes,
      eq(receiptTaxes.detailId, receiptDetails.detailId),
    )
    .where(eq(receiptDetails.receiptId, receiptId))
    .orderBy(asc(receiptDetails.lineNumber));

  if (
    savedLines.length === 0 ||
    savedLines.some((line) => line.taxCode !== "01")
  ) {
    return permanentFailure(
      "No se pudieron reconstruir las líneas y los impuestos",
    );
  }

  const savedPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.receiptId, receiptId))
    .limit(2);

  if (savedPayments.length !== 1) {
    return permanentFailure(
      "No se pudo identificar el método de pago del recibo",
    );
  }

  const paymentMethods = {
    "01": "cash",
    "02": "card",
    "06": "sinpe",
  } as const;

  const paymentMethod =
    paymentMethods[
      savedPayments[0].method as keyof typeof paymentMethods
    ];

  if (!paymentMethod) {
    return permanentFailure("El método de pago guardado no es válido");
  }

  const savedCharges = await db
    .select()
    .from(otherCharges)
    .where(eq(otherCharges.receiptId, receiptId));

  if (savedCharges.some((charge) => charge.chargeType !== "06")) {
    return permanentFailure(
      "El recibo tiene cargos que esta emisión no puede reconstruir",
    );
  }

  const serviceCharge = savedCharges
    .reduce((sum, charge) => sum + Number(charge.amount), 0)
    .toFixed(2);

  const lines = savedLines.map(({ detail, taxRateCode, taxRate }) => ({
    detail: detail.detail,
    quantity: Number(detail.quantity),
    unitPrice: detail.unitPrice,
    discount: detail.discountAmount,
    subtotal: detail.subtotal,
    tax: detail.taxAmount,
    cabysCode: detail.cabysCode,
    ivaRate: taxRate,
    ivaRateCode: taxRateCode,
  }));

  const emission = await emitTiquete({
    receiptId,
    orderId: receipt.orderId,
    issuer,
    lines,
    total: receipt.totalVoucher,
    serviceCharge,
    chargesVat: issuer.chargesVat !== false,
    paymentMethod,
    substituteKey,
  });

  if (emission.ok) {
    return { ok: true };
  }

  // Un 4xx suele requerir corregir datos. Red, 429, 5xx y
  // idempotency_in_progress se pueden reintentar con la misma clave.
  const retryable =
    emission.code === "idempotency_in_progress" ||
    emission.status === null ||
    emission.status === 429 ||
    (emission.status !== null && emission.status >= 500);

  return {
    ok: false,
    retryable,
    message: emission.message,
    retryAfterSeconds: emission.retryAfterSeconds
  };
}