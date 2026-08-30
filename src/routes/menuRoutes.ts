import { Router } from "express";
import { createProduct, getProducts,getProductsById } from "../controllers/adminMenuController";
import { upload } from "../middleware/upload";

const router = Router();

router.get("/products",getProducts);
router.get("/products/:id",getProductsById);
router.post("/products", upload.single("image"), createProduct);

export default router;