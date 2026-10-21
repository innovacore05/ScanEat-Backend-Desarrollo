// En src/routes/webhookRoutes.ts
import { Router } from "express";
import { handleFacturaEnCrWebhook } from "../controllers/webHookController";
const router = Router();

// Endpoint público para recibir webhooks
router.post("/facturaencr", handleFacturaEnCrWebhook);

export default router;