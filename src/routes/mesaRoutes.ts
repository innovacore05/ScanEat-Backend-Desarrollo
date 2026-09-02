import { Router } from "express";
import {
  createTable,
  getTables,
  getTableById,
  deleteTable,
  updateTableChairs,
} from "../controllers/mesaController";
import { validateBody, validateParams } from "../middleware/validations";
import {
  createTableSchema,
  tableParamsSchema,
  updateTableChairsSchema,
} from "../db/schemas/mesaSchema";

const router = Router();

router.post("/", validateBody(createTableSchema), createTable);
router.get("/", getTables);
router.get("/:id", validateParams(tableParamsSchema), getTableById);
router.put(
  "/:id",
  validateParams(tableParamsSchema),
  validateBody(updateTableChairsSchema),
  updateTableChairs,
);
router.delete("/:id", validateParams(tableParamsSchema), deleteTable);
export default router;
