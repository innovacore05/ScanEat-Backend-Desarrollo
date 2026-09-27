import { Router } from "express";
import { createBusiness , updateBusiness} from "../controllers/businessController";
import { authenticate, requireRole } from "../middleware/authenticate";
import { validateBody } from "../middleware/validations";
import { createBusinessSchema, updateBusinessSchema } from "../db/schemas/userSchema";

const router = Router();

router.post("/",authenticate,requireRole(1),validateBody(createBusinessSchema),createBusiness);
router.patch("/",authenticate,requireRole(1),validateBody(updateBusinessSchema),updateBusiness);

export default router;