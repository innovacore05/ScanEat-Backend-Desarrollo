import {
  and,
  asc,
  eq,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import db from "../db/connection";
import {
  receiptEmissionJobs,
  receipts,
} from "../db/schemas/billingSchema";
import { emitReceiptForQueue } from "./receiptEmission.service";

const MAX_ATTEMPTS = 5;
const CHECK_EVERY_MS = 2_000;
const LOCK_TIMEOUT_MS = 5 * 60_000;

async function claimNextJob() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);

  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(receiptEmissionJobs)
      .where(
        or(
          and(
            eq(receiptEmissionJobs.status, "pending"),
            lte(receiptEmissionJobs.availableAt, now),
          ),
          and(
            eq(receiptEmissionJobs.status, "processing"),
            lt(receiptEmissionJobs.lockedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(receiptEmissionJobs.availableAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!job) return null;

    const [claimedJob] = await tx
      .update(receiptEmissionJobs)
      .set({
        status: "processing",
        lockedAt: now,
        attempts: sql`${receiptEmissionJobs.attempts} + 1`,
      })
      .where(eq(receiptEmissionJobs.jobId, job.jobId))
      .returning();

    return claimedJob;
  });
}

async function markCompleted(jobId: number) {
  await db
    .update(receiptEmissionJobs)
    .set({
      status: "completed",
      lockedAt: null,
      lastError: null,
    })
    .where(eq(receiptEmissionJobs.jobId, jobId));
}

async function markFailed(
  jobId: number,
  receiptId: number,
  message: string,

) {
  await db.transaction(async (tx) => {
    await tx
      .update(receiptEmissionJobs)
      .set({
        status: "failed",
        lockedAt: null,
        lastError: message.slice(0, 1000),
      })
      .where(eq(receiptEmissionJobs.jobId, jobId));

    await tx
      .update(receipts)
      .set({
        haciendaStatus: "failed",
        lastError: message.slice(0, 1000),
      })
      .where(eq(receipts.receiptId, receiptId));
  });
}

async function scheduleRetry(
  jobId: number,
  message: string,
  attempts: number,
  retryAfterSeconds?: number,
) {
  // Reintentos después de 1, 2, 4, 8 minutos.
  const fallbackDelayMinutes = Math.min(
  2 ** Math.max(attempts - 1, 0),
  30,
);

const delayMs =
  typeof retryAfterSeconds === "number" &&
  Number.isFinite(retryAfterSeconds)
    ? Math.max(retryAfterSeconds, 1) * 1000
    : fallbackDelayMinutes * 60_000;

const availableAt = new Date(Date.now() + delayMs);
  await db
    .update(receiptEmissionJobs)
    .set({
      status: "pending",
      availableAt,
      lockedAt: null,
      lastError: message.slice(0, 1000),
    })
    .where(eq(receiptEmissionJobs.jobId, jobId));
}

async function processOneJob() {
  const job = await claimNextJob();
  if (!job) return;

  try {
    const result = await emitReceiptForQueue(job.receiptId);

    if (result.ok) {
      await markCompleted(job.jobId);
      return;
    }

    if (!result.retryable || job.attempts >= MAX_ATTEMPTS) {
      await markFailed(job.jobId, job.receiptId, result.message);
      return;
    }

    await scheduleRetry(
  job.jobId,
  result.message,
  job.attempts,
  result.retryAfterSeconds,
);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";

    if (job.attempts >= MAX_ATTEMPTS) {
      await markFailed(job.jobId, job.receiptId, message);
      return;
    }

    await scheduleRetry(job.jobId, message, job.attempts);
  }
}

export function startReceiptEmissionWorker() {
  let isRunning = false;

  const timer = setInterval(async () => {
    if (isRunning) return;

    isRunning = true;
    try {
      await processOneJob();
    } catch (error) {
      console.error("Error en el worker de tiquetes:", error);
    } finally {
      isRunning = false;
    }
  }, CHECK_EVERY_MS);

  timer.unref();
}