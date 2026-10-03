import { Router } from "express";
import { getPublicRestaurantTheme } from "../controllers/themeController";
import { getPublicTableNumber } from "../controllers/mesaController";

const router = Router();

router.get("/tables/:tableId", getPublicTableNumber);
router.get("/tables/:tableId/theme", getPublicRestaurantTheme);

export default router;