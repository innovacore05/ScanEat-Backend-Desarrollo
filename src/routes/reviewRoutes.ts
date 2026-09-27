import { Router } from "express";
import {
  createReviews,
  deleteReview,
  getOrderReviewItems,
  getProductReviews,
} from "../controllers/reviewController";
import { authenticate, requireRole } from "../middleware/authenticate";

const router = Router();

router.get("/orders/:orderId", getOrderReviewItems);
router.post("/orders/:orderId", createReviews);
router.get("/products/:productId", getProductReviews);
router.delete("/:reviewId", authenticate, requireRole(1), deleteReview);

export default router;