import { Router } from "express";
import { createOrder, getOrders } from "../controllers/orderController";
import { validateBody } from "../middleware/validations";
import { createOrderSchema } from "../db/schemas/orderSchema";
import { authenticate, requireRole } from "../middleware/authenticate";

const router = Router();

router.post("/", validateBody(createOrderSchema), createOrder);
router.get("/", getOrders);

export default router;
