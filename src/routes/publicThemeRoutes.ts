import { Router } from "express";
import { getPublicRestaurantTheme } from "../controllers/themeController";

const router = Router();

router.get(
  "/tables/:tableId/theme",
  getPublicRestaurantTheme,
);

export default router;