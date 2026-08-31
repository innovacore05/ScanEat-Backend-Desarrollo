import { Router } from "express";
import { createProduct, 
    getProducts,
    getProductsById,
createCustomDish,getCategories} from "../controllers/adminMenuController";
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

//CAMBIO:uploadMemory 
//platillo simple 
router.post("/products", uploadMemory.single("image"), createProduct);

//platillo personalzado
router.post("/products/custom",authenticate,uploadMemory.single("image"),parseFormDataJson(["optionGroups"]),validateBody(createCustomDishSchema),createCustomDish);

export default router;



