
import { Router } from "express";
import {
  createProduct,
  getProducts,
  getProductsById,
  createCustomDish,
  getCategories,
  createCategory,
  deleteCategory,
  updateCategory,
  updateProduct,
  updateCustomDish,
  deleteProduct,
  deleteCustomProduct,

} from "../controllers/adminMenuController";
import { upload } from "../middleware/upload";
import { validateBody } from "../middleware/validations";
import { parseFormDataJson } from "../middleware/parseFormDataJson";
import { createCustomDishSchema, createProductSchema, createCategorySchema,} from "../db/schemas/adminMenuSchema";
import { authenticate, requireRole, optionalAuthenticate, } from "../middleware/authenticate";
import { getFiscalOptions, searchCabys } from "../controllers/cabysController";



const router = Router();

router.get("/products",optionalAuthenticate, getProducts);
router.get("/products/:id",getProductsById);
router.get("/categories", optionalAuthenticate, getCategories);
router.post("/categories", authenticate, requireRole(1), validateBody(createCategorySchema), createCategory);
router.delete("/categories/:id",authenticate,requireRole(1),deleteCategory);
router.put("/categories/:id",authenticate,requireRole(1),updateCategory);

//CAMBIO:uploadMemory 
//platillo simple 

router.post("/products",authenticate,requireRole(1),upload.single("image"),validateBody(createProductSchema),createProduct);
router.put("/products/:id",authenticate,requireRole(1), upload.single("image"), updateProduct);
router.patch("/products/:id",authenticate,requireRole(1), upload.single("image"), updateProduct);
router.delete("/products/:id",authenticate,requireRole(1), deleteProduct);

//platillo personalzado
router.post("/products/custom",authenticate,requireRole(1),upload.single("image"),parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema),createCustomDish);
router.put("/products/custom/:id", authenticate,requireRole(1), upload.single("image"), parseFormDataJson(["optionGroups"]), validateBody(createCustomDishSchema), updateCustomDish);
router.patch("/products/custom/:id", authenticate,requireRole(1), upload.single("image"), parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema), updateCustomDish);
router.delete("/products/custom/:id", authenticate,requireRole(1), deleteCustomProduct);



//rutas para el cabys
router.get("/fiscal-options", authenticate,requireRole(1), getFiscalOptions);
router.get( "/cabys/search",authenticate,requireRole(1),searchCabys,);



export default router;