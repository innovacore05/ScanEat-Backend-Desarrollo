import { Router } from "express";
import {
  createTable,
  getTables,
  getTableById,
  deleteTable,
  updateTableChairs,
} from "../controllers/mesaController";
import { validateBody, validateParams } from "../middleware/validations";
import { authenticate, requireRole } from "../middleware/authenticate";
import {
  createTableSchema,
  tableParamsSchema,
  updateTableChairsSchema,
} from "../db/schemas/mesaSchema";

const router = Router();

router.post("/", authenticate, requireRole(1), validateBody(createTableSchema), createTable);
router.get("/", authenticate, getTables);
router.get("/:id", authenticate, validateParams(tableParamsSchema), getTableById);
router.put(
  "/:id",
  authenticate,
  requireRole(1),
  validateParams(tableParamsSchema),
  validateBody(updateTableChairsSchema),
  updateTableChairs,
);
router.patch(
  "/:id",
  authenticate,
  requireRole(1),
  validateParams(tableParamsSchema),
  validateBody(updateTableChairsSchema),
  updateTableChairs,
);
router.delete("/:id", authenticate, requireRole(1), validateParams(tableParamsSchema), deleteTable);
export default router;
