import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { createTableSchema, tables, tableParamsSchema } from "../db/schemas/mesaSchema";
import { validateBody, validateParams } from "../middleware/validations";

export const createTable = async (req: Request, res: Response) => {
  try {
    const parsed = createTableSchema.parse(req.body);

    const [mesa] = await db
      .insert(tables)
      .values({
        tableNumber: parsed.tableNumber,
        chairNumber: parsed.chairNumber,
      })
      .returning();

    return res.status(201).json({
      id: mesa.id,
      tableNumber: mesa.tableNumber,
      chairNumber: mesa.chairNumber,
      active: mesa.active,
      createdAt: mesa.createdAt,
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({
        message: "Ya existe una mesa con ese número",
      });
    }

    console.error("Error creando mesa:", error);

    return res.status(500).json({
      message: "No se pudo crear la mesa",
    });
  }
};

export const getTables = async (_req: Request, res: Response) => {
  try {
    const mesaList = await db
      .select()
      .from(tables)
      .orderBy(tables.tableNumber);

    return res.status(200).json(mesaList);
  } catch (error) {
    console.error("Error obteniendo mesas:", error);

    return res.status(500).json({
      message: "No se pudieron obtener las mesas",
    });
  }
};

export const getTableById = async (req: Request, res: Response) => {
  try {
    const { id } = tableParamsSchema.parse(req.params);

    const [mesa] = await db
      .select()
      .from(tables)
      .where(eq(tables.id, id))
      .limit(1);

    if (!mesa) {
      return res.status(404).json({
        message: "Mesa no encontrada",
      });
    }

    return res.status(200).json(mesa);
  } catch (error) {
    console.error("Error obteniendo mesa:", error);

    return res.status(500).json({
      message: "No se pudo obtener la mesa",
    });
  }
};
