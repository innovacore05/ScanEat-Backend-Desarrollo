import { Router } from "express";
import { createBusiness } from "../controllers/businessController";
import { authenticate, requireRole } from "../middleware/authenticate";
import { validateBody } from "../middleware/validations";
import { createBusinessSchema } from "../db/schemas/userSchema";

const router = Router();

router.post("/",authenticate,requireRole(1),validateBody(createBusinessSchema),createBusiness);

export default router;