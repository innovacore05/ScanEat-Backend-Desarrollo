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
import { createCustomDishSchema } from "../db/schemas/adminMenuSchema";
import { authenticate } from "../middleware/authenticate";
import multer from "multer";

//R2
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get("/products",getProducts);
router.get("/products/:id",getProductsById);
router.get("/categories", getCategories);

//CAMBIO:uploadMemory y authentcate
//platillo simple 
router.post("/products", uploadMemory.single("image"), createProduct);
router.put("/products/:id", uploadMemory.single("image"), updateProduct);
router.patch("/products/:id", uploadMemory.single("image"), updateProduct);
router.delete("/products/:id", deleteProduct);

//platillo personalzado
router.post("/products/custom",authenticate,uploadMemory.single("image"),parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema),createCustomDish);
router.put("/products/custom/:id", authenticate, uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.patch("/products/custom/:id", authenticate, uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.delete("/products/custom/:id", authenticate, deleteCustomProduct);

export default router;



