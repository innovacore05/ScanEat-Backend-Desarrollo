import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

import db from "../db/connection";
import { receipts } from "../db/schemas/billingSchema";
import { refreshReceiptStatus } from "../services/factura.service";

function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );

  const timestamp = Number(parts.t);
  const signature = parts.v1;

  if (!Number.isFinite(timestamp) || !signature) return false;

  // Rechaza avisos con más de cinco minutos.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest();

  const received = Buffer.from(signature, "hex");

  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

export async function facturaEnCrWebhook(
  req: Request,
  res: Response,
) {
  const secret = process.env.EFACTURA_WEBHOOK_SECRET;

  if (!secret) {
    console.error("Falta configurar EFACTURA_WEBHOOK_SECRET");
    return res.sendStatus(503);
  }

  if (!Buffer.isBuffer(req.body)) {
    return res.sendStatus(400);
  }

  if (
    !isValidSignature(
      req.body,
      req.get("X-Efactura-Signature"),
      secret,
    )
  ) {
    return res.sendStatus(401);
  }



let event: {
  event?: unknown;
  documentId?: unknown;
  haciendaMessage?: unknown;
  data?: {
    test?: unknown;
    haciendaMessage?: unknown;
  };
};

try {
  event = JSON.parse(req.body.toString("utf8"));
} catch {
  return res.sendStatus(400);
}

if (event.data?.test === true) {
  return res.sendStatus(200);
}


  if (
    typeof event.documentId !== "string" ||
    !event.documentId
  ) {
    return res.sendStatus(400);
  }

  if (
  event.event !== "document.accepted" &&
  event.event !== "document.rejected"
) {
  return res.sendStatus(200);
}

try {
  const [receipt] = await db
    .select({
      receiptId: receipts.receiptId,
      businessId: receipts.businessId,
    })
    .from(receipts)
    .where(eq(receipts.integratorDocumentId, event.documentId))
    .limit(1);

  if (!receipt) {
    return res.sendStatus(503);
  }

  await refreshReceiptStatus(receipt.receiptId, receipt.businessId, {
    force: true,
  });

  return res.sendStatus(200);
} catch (error) {
  console.error("Error procesando webhook de Facturaencr:", error);
  return res.sendStatus(503);
}
}