import { Router } from "express";
import {
  getRestaurantTheme,
  updateRestaurantTheme, uploadRestaurantLogo,
} from "../controllers/themeController";
import {
    authenticate,
    requireRole,
} from "../middleware/authenticate";
import { themeUpload } from "../middleware/themeUpload";

const router = Router();

router.get(
    "/:businessId/theme",
    authenticate,
    requireRole(1, 2, 3, 4),
    getRestaurantTheme,
);
router.put(
  "/:businessId/theme",
  authenticate,
  requireRole(1),
  updateRestaurantTheme,
);
router.post(
  "/:businessId/theme/logo",
  authenticate,
  requireRole(1),
  themeUpload.single("logo"),
  uploadRestaurantLogo,
);

export default router;