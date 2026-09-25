import { Request, Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import { eq, and} from "drizzle-orm";
import { db } from "../db/connection";
import {
  createTableSchema,
  tables,
  tableParamsSchema,
  updateTableChairsSchema,
} from "../db/schemas/mesaSchema";
import { validateBody, validateParams } from "../middleware/validations";

export const createTable = async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createTableSchema.parse(req.body);
    const businessId = req.user?.business_id;

if (!businessId) {
  return res.status(400).json({
    message: "El usuario no tiene un negocio asociado",
  });
}

    const [mesa] = await db
      .insert(tables)
      .values({
  tableNumber: parsed.tableNumber,
  chairNumber: parsed.chairNumber,
  businessId,
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

export const getTables = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;

if (!businessId) {
  return res.status(400).json({
    message: "El usuario no tiene un negocio asociado",
  });
}
    const mesaList = await db
      .select()
      .from(tables)
      .where(eq(tables.businessId, businessId))
      .orderBy(tables.tableNumber);

    return res.status(200).json(mesaList);
  } catch (error) {
    console.error("Error obteniendo mesas:", error);

    return res.status(500).json({
      message: "No se pudieron obtener las mesas",
    });
  }
};

export const getTableById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = tableParamsSchema.parse(req.params);
    const businessId = req.user?.business_id;

if (!businessId) {
  return res.status(400).json({
    message: "El usuario no tiene un negocio asociado",
  });
}

    const [mesa] = await db
      .select()
      .from(tables)
      .where(
  and(
    eq(tables.id, id),
    eq(tables.businessId, businessId)
  )
)
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

//controller para actualizar la cantidad de sillas de una mesa
export const updateTableChairs = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = tableParamsSchema.parse(req.params);
    const businessId = req.user?.business_id;

if (!businessId) {
  return res.status(400).json({
    message: "El usuario no tiene un negocio asociado",
  });
}
    const { chairNumber } = updateTableChairsSchema.parse(req.body);

    const [mesa] = await db
      .update(tables)
      .set({ chairNumber })
      .where(
  and(
    eq(tables.id, id),
    eq(tables.businessId, businessId)
  )
)
      .returning();

    if (!mesa) {
      return res.status(404).json({
        message: "Mesa no encontrada",
      });
    }

    return res.status(200).json(mesa);
  } catch (error) {
    console.error("Error actualizando mesa:", error);

    return res.status(500).json({
      message: "No se pudo actualizar la mesa",
    });
  }
};

//controller para eliminar una mesa
export const deleteTable = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = tableParamsSchema.parse(req.params);
    const businessId = req.user?.business_id;

if (!businessId) {
  return res.status(400).json({
    message: "El usuario no tiene un negocio asociado",
  });
}

    const [mesa] = await db
      .delete(tables)
      .where(
  and(
    eq(tables.id, id),
    eq(tables.businessId, businessId)
  )
)
      .returning();

    if (!mesa) {
      return res.status(404).json({
        message: "Mesa no encontrada",
      });
    }

    return res.status(200).json({
      message: "Mesa eliminada correctamente",
    });
  } catch (error) {
    console.error("Error eliminando mesa:", error);

    return res.status(500).json({
      message: "No se pudo eliminar la mesa",
    });
  }
}
