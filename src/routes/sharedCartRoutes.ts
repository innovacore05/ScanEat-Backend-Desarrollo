import { Router } from "express";
import { addItem, getCart, removeItem, submitCart, updateItem } from "../controllers/sharedCartController";

const router = Router();

router.get("/:tableId", getCart);
router.post("/:tableId/items", addItem);
router.patch("/:tableId/items/:itemId", updateItem);
router.delete("/:tableId/items/:itemId", removeItem);



router.post("/:tableId/submit", submitCart);

export default router;