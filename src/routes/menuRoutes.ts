import { Router } from "express";
import { getProducts,getProductsById } from "../controllers/adminMenuController";


const router = Router();

router.get("/products",getProducts);
router.get("/products/:id",getProductsById);


export default router;