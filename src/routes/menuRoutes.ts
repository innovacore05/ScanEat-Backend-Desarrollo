import { Router } from "express";
import {
  createProduct,
  getProducts,
  getProductsById,
  createCustomDish,
  getCategories,
  updateProduct,
  updateCustomDish,
  deleteProduct,
  deleteCustomProduct,
} from "../controllers/adminMenuController";
import { upload } from "../middleware/upload";
import { validateBody } from "../middleware/validations";
import { parseFormDataJson } from "../middleware/parseFormDataJson";
import { createCustomDishSchema, createProductSchema} from "../db/schemas/adminMenuSchema";
import { authenticate, requireRole } from "../middleware/authenticate";
import multer from "multer";

//R2
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get("/products", getProducts);
router.get("/products/:id", getProductsById);
router.get("/categories", getCategories);

//CAMBIO:uploadMemory 
//platillo simple 

router.post("/products",authenticate,requireRole(1),uploadMemory.single("image"),validateBody(createProductSchema),createProduct);
router.put("/products/:id",authenticate,requireRole(1), uploadMemory.single("image"), updateProduct);
router.patch("/products/:id",authenticate,requireRole(1), uploadMemory.single("image"), updateProduct);
router.delete("/products/:id",authenticate,requireRole(1), deleteProduct);

//platillo personalzado
router.post("/products/custom",authenticate,requireRole(1),uploadMemory.single("image"),parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema),createCustomDish);
router.put("/products/custom/:id", authenticate,requireRole(1), uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.patch("/products/custom/:id", authenticate,requireRole(1), uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.delete("/products/custom/:id", authenticate,requireRole(1), deleteCustomProduct);

export default router;


