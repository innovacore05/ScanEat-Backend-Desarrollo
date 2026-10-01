import { Router } from "express";
import { getPaymentPreview } from "../controllers/billingController";
   import { authenticate,requireRole } from "../middleware/authenticate";


const router = Router();

router.get("/orders/:orderId",authenticate,requireRole(4),getPaymentPreview);

// router.post(
//   "/orders/:orderId/payments",
//   authenticate,
//   requireRole(4),
//   payOrder
// );

export default router;