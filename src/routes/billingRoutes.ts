import { Router } from "express";
import { getPaymentPreview,payOrder,getReceiptStatus, retryReceiptEmission,replaceRejectedReceipt } from "../controllers/billingController";
   import { authenticate,requireRole } from "../middleware/authenticate";


const router = Router();

router.get("/orders/:orderId",authenticate,requireRole(4),getPaymentPreview);

router.post("/orders/:orderId/payments", authenticate,requireRole(4),payOrder);

router.get("/receipts/:receiptId/status", authenticate, requireRole(4), getReceiptStatus);

router.post("/receipts/:receiptId/retry-emission",authenticate, requireRole(4),  retryReceiptEmission,
);

router.post("/receipts/:receiptId/replace-rejected", authenticate,requireRole(4), replaceRejectedReceipt,);

export default router;