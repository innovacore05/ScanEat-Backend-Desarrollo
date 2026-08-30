import { Router } from "express";
import multer from "multer";
import { customDishController } from "../controllers/customDishController";
import { validateBody } from "../middleware/validations";
import { parseFormDataJson } from "../middleware/parseFormDataJson";
import { createCustomDishSchema } from "../db/schemas/customDish";
import { authenticate } from "../middleware/authenticate";

const upload=multer({
    storage:multer.memoryStorage(),
    limits:{fileSize:5*1024*1024}
});

const router=Router();

router.post("/dishes/custom",authenticate, upload.single("image"),parseFormDataJson(["optionGroups"]),
  validateBody(createCustomDishSchema), customDishController);

export default router;