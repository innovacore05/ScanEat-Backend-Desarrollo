import { Router } from "express";
import {
  confirmOrder,
  createOrder,
  deliverOrder,
  getOrders,
  getOrderStatus,
  markOrderReady,
  getActiveOrder
} from "../controllers/orderController";
import { validateBody } from "../middleware/validations";
import { createOrderSchema } from "../db/schemas/orderSchema";
import { authenticate, requireRole } from "../middleware/authenticate";

const router = Router();

router.post("/", validateBody(createOrderSchema), createOrder);
router.get("/", authenticate, requireRole(1, 2, 3), getOrders);

//nuevo
router.get("/active/:tableId", getActiveOrder);


router.get("/:id/status", getOrderStatus);
router.patch("/:id/confirm", authenticate, requireRole(3), confirmOrder);
router.patch("/:id/ready", authenticate,requireRole(2), markOrderReady);
router.patch("/:id/deliver", authenticate, requireRole(3), deliverOrder);

export default router;
