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

import { validateBody } from "../middleware/validations";
import { parseFormDataJson } from "../middleware/parseFormDataJson";
import { createCustomDishSchema , createProductSchema} from "../db/schemas/adminMenuSchema";
import { authenticate } from "../middleware/authenticate";
import multer from "multer";

//R2
const uploadMemory = multer({
  storage: multer.memoryStorage(),
 limits: { fileSize: 1 * 1024 * 1024 },
 fileFilter:(req,file,cb)=>{
  if(!file.mimetype.startsWith("image/")){
    return cb(new Error("El archivo debe ser una iamgen"));
  }
  cb(null,true);
 }
});

const router = Router();

router.get("/products",getProducts);
router.get("/products/:id",getProductsById);
router.get("/categories", getCategories);

//CAMBIO:uploadMemory 
//platillo simple 
router.post("/products", authenticate, 
  uploadMemory.single("image"),validateBody(createProductSchema),createProduct);
router.put("/products/:id", authenticate, uploadMemory.single("image"), updateProduct);
router.patch("/products/:id", authenticate, uploadMemory.single("image"), updateProduct);
router.delete("/products/:id", authenticate, deleteProduct);

//platillo personalzado
router.post("/products/custom",authenticate,
  uploadMemory.single("image"),parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema),createCustomDish);
router.put("/products/custom/:id", authenticate, uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.patch("/products/custom/:id", authenticate, uploadMemory.single("image"), parseFormDataJson(["optionGroups"]), updateCustomDish);
router.delete("/products/custom/:id", authenticate, deleteCustomProduct);

export default router;



