
import { Router } from "express";
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  downloadExpenseInvoice,
} from "../controllers/expensesController";
import { authenticate } from "../middleware/authenticate";
import { uploadInvoice } from "../middleware/upload";

const router = Router();

router.get("/", authenticate, getExpenses);
router.post("/", authenticate, uploadInvoice.single("invoice"), createExpense);
router.put("/:id", authenticate, uploadInvoice.single("invoice"), updateExpense);
router.delete("/:id", authenticate, deleteExpense);
router.get("/:id/invoice",authenticate,downloadExpenseInvoice);

export default router;
