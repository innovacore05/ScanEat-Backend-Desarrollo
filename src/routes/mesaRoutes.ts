import { Router } from "express";
import { createTable, getTables, getTableById } from "../controllers/mesaController";
import { validateBody, validateParams } from "../middleware/validations";
import { createTableSchema, tableParamsSchema } from "../db/schemas/mesaSchema";
//actualziacion de ali
const router = Router();

router.post("/", validateBody(createTableSchema), createTable);
router.get("/", getTables);
router.get("/:id", validateParams(tableParamsSchema), getTableById);

export default router;
