import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/authenticate";
import db from "../db/connection";
import {
  invoicingConfig,
  receipts,
} from "../db/schemas/billingSchema";
import { downloadFacturaEnCrFile } from "../services/factura.service";

const DOCUMENT_TYPES = ["03", "04"] as const;
const MAX_PAGE_SIZE = 50;
const IN_PROGRESS = ["pending", "queued", "signing", "sent", "polling"];

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00-06:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toStatus = (status: string): string =>
  status === "not_sent" ? "failed" : status;

export const listIssuedReceipts = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      return res.status(403).json({ message: "El usuario no tiene negocio asociado." });
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    if (!from || !to || from > to) {
      return res.status(400).json({ message: "El rango de fechas no es válido." });
    }

    const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(req.query.limit) || 10),
    );
    const offset = (page - 1) * limit;

    const conditions = [
      eq(receipts.businessId, businessId),
      inArray(receipts.documentType, [...DOCUMENT_TYPES]),
      gte(receipts.issueDate, from),
      lt(receipts.issueDate, toExclusive),
    ];

    const status = typeof req.query.status === "string" ? req.query.status : "";

    if (status === "accepted" || status === "rejected") {
      conditions.push(eq(receipts.haciendaStatus, status));
    } else if (status === "failed") {
      conditions.push(eq(receipts.haciendaStatus, "not_sent"));
    } else if (status === "in_progress") {
      conditions.push(inArray(receipts.haciendaStatus, IN_PROGRESS));
    } else if (status !== "") {
      return res.status(400).json({ message: "El filtro de estado no es válido." });
    }

    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (search) {
      conditions.push(
        or(
          ilike(receipts.clave, `%${search}%`),
          ilike(receipts.consecutiveNumber, `%${search}%`),
        )!,
      );
    }

    const where = and(...conditions);

    const [rows, countRows, summaryRows] = await Promise.all([
      db
        .select()
        .from(receipts)
        .where(where)
        .orderBy(desc(receipts.issueDate), desc(receipts.receiptId))
        .limit(limit)
        .offset(offset),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(receipts)
        .where(where),

      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${receipts.totalVoucher}), 0)`,
          taxTotal: sql<string>`coalesce(sum(
            case when ${receipts.haciendaStatus} = 'accepted'
            then ${receipts.totalTax} else 0 end
          ), 0)`,
          acceptedCount: sql<number>`count(*) filter (
            where ${receipts.haciendaStatus} = 'accepted'
          )::int`,
        })
        .from(receipts)
        .where(where),
    ]);

    const rowIds = rows.map((row) => row.receiptId);
    const replacements = rowIds.length
      ? await db
          .select({
            originalId: receipts.replacesReceiptId,
            replacementId: receipts.receiptId,
          })
          .from(receipts)
          .where(
            and(
              eq(receipts.businessId, businessId),
              inArray(receipts.replacesReceiptId, rowIds),
            ),
          )
      : [];

    const replacementByOriginal = new Map(
      replacements.map((row) => [row.originalId, row.replacementId]),
    );

    const summary = summaryRows[0];

    return res.json({
      items: rows.map((row) => ({
        id: String(row.receiptId),
        issuedAt: row.issueDate.toISOString(),
        documentType: row.documentType,
        consecutivo: row.consecutiveNumber ?? "",
        clave: row.clave ?? "",
        total: Number(row.totalVoucher),
        tax: Number(row.totalTax),
        status: toStatus(row.haciendaStatus),
        hasXml: Boolean(row.integratorDocumentId),
        haciendaMessage: row.haciendaMessage ?? row.lastError ?? null,
        replacedById: replacementByOriginal.has(row.receiptId)
          ? String(replacementByOriginal.get(row.receiptId))
          : null,
      })),
      page,
      limit,
      total: Number(countRows[0]?.count ?? 0),
      summary: {
        count: Number(summary?.count ?? 0),
        total: Number(summary?.total ?? 0),
        taxTotal: Number(summary?.taxTotal ?? 0),
        acceptedCount: Number(summary?.acceptedCount ?? 0),
      },
    });
  } catch (error) {
    console.error("Error listando tiquetes y notas de crédito:", error);
    return res.status(500).json({ message: "No se pudieron cargar los comprobantes." });
  }
};

export const downloadIssuedReceiptXml = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const businessId = req.user?.business_id;
    const receiptId = Number(req.params.receiptId);

    if (!businessId || !Number.isInteger(receiptId) || receiptId <= 0) {
      return res.status(400).json({ message: "Solicitud no válida." });
    }

    const [receipt] = await db
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.receiptId, receiptId),
          eq(receipts.businessId, businessId),
          inArray(receipts.documentType, [...DOCUMENT_TYPES]),
        ),
      )
      .limit(1);

    if (!receipt) {
      return res.status(404).json({ message: "Comprobante no encontrado." });
    }

    if (!receipt.integratorDocumentId) {
      return res.status(409).json({ message: "El XML todavía no está disponible." });
    }

    const [issuer] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    if (!issuer) {
      return res.status(409).json({ message: "Falta configurar el emisor." });
    }

    const file = await downloadFacturaEnCrFile(
      `/documents/${encodeURIComponent(receipt.integratorDocumentId)}/xml`,
      issuer.legalId,
    );

    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${receipt.consecutiveNumber ?? receipt.receiptId}.xml"`,
    );

    return res.send(file.body);
  } catch (error) {
    console.error("Error descargando XML:", error);
    return res.status(502).json({ message: "No se pudo descargar el XML." });
  }
};

