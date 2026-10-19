// src/controllers/webhookController.ts
import { Request, Response } from "express";
import db from "../db/connection";
import { receipts } from "../db/schemas/billingSchema";
import { eq } from "drizzle-orm";

export const handleFacturaEnCrWebhook = async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    
    // Factura en CR envía eventos como "document.accepted" o "document.rejected"
    const { event, document } = payload;
    
    // Validamos que venga la clave para saber qué recibo actualizar
    if (!document || !document.clave) {
      return res.status(400).json({ message: "Payload inválido, falta la clave" });
    }

    const { clave, status, hacienda_message } = document;

    // Mapeamos el estado de Factura en CR a nuestro estado en base de datos
    let newStatus = "queued";
    if (event === "document.accepted" || status === "accepted") {
      newStatus = "accepted";
    } else if (event === "document.rejected" || status === "rejected") {
      newStatus = "rejected";
    }

    // Actualizamos el recibo en base de datos usando la clave única
    await db.update(receipts)
      .set({
        haciendaStatus: newStatus,
        haciendaMessage: hacienda_message || (newStatus === "accepted" ? "Aceptado por Hacienda" : "Rechazado por Hacienda"),
      })
      .where(eq(receipts.clave, clave));

    // Es crucial devolver un 200 OK rápido para que Factura en CR no intente reenviar el webhook
    return res.status(200).send("Webhook recibido y procesado");
    
  } catch (error) {
    console.error("Error procesando webhook de Factura en CR:", error);
    return res.status(500).send("Error interno");
  }
};