
import { Router } from "express";
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  downloadExpenseInvoice,
} from "../controllers/expensesController";
import { authenticate,requireRole } from "../middleware/authenticate";
import { uploadInvoice } from "../middleware/upload";

const router = Router();

router.get("/", authenticate,requireRole(1), getExpenses);
router.post("/", authenticate,requireRole(1), uploadInvoice.single("invoice"), createExpense);
router.put("/:id", authenticate,requireRole(1), uploadInvoice.single("invoice"), updateExpense);
router.delete("/:id", authenticate,requireRole(1), deleteExpense);
router.get("/:id/invoice",authenticate,requireRole(1),downloadExpenseInvoice);

export default router;
