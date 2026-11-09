import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authenticate";
import {
  downloadIssuedReceiptXml,
  listIssuedReceipts,
} from "../controllers/ReceiptHistoryController";
import {
  getReceiptStatus,
  retryReceiptEmission,
  replaceRejectedReceipt,
  
} from "../controllers/billingController";

const router = Router();

router.get("/", authenticate, requireRole(1), listIssuedReceipts);

router.post("/:receiptId/refresh", authenticate, requireRole(1), getReceiptStatus);
router.post("/:receiptId/retry", authenticate, requireRole(1), retryReceiptEmission);
router.post("/:receiptId/replace", authenticate, requireRole(1), replaceRejectedReceipt);
router.get( "/:receiptId/xml", authenticate,requireRole(1),downloadIssuedReceiptXml);
export default router;
