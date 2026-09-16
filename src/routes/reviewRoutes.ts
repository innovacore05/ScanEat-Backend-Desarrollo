import { Router } from "express";
import {
  createReviews,
  getOrderReviewItems,
  getProductReviews,
} from "../controllers/reviewController";

const router = Router();

router.get("/orders/:orderId", getOrderReviewItems);
router.post("/orders/:orderId", createReviews);
router.get("/products/:productId", getProductReviews);

export default router;