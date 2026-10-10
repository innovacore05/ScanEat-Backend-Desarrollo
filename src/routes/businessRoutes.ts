import { Router } from "express";
import { createBusiness , updateBusiness, generateBusinessCode,} from "../controllers/businessController";
import { authenticate, requireRole } from "../middleware/authenticate";
import { validateBody } from "../middleware/validations";
import { createBusinessSchema, updateBusinessSchema } from "../db/schemas/userSchema";

const router = Router();

// Generar un código para el negocio
router.get("/generate-code",authenticate,requireRole(1),generateBusinessCode);
router.post("/",authenticate,requireRole(1),validateBody(createBusinessSchema),createBusiness);
router.patch("/",authenticate,requireRole(1),validateBody(updateBusinessSchema),updateBusiness);

export default router;