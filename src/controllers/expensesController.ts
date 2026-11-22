
import { Response } from "express";
import { and, desc, eq, ilike, or, gte, lte } from "drizzle-orm";
import { AuthRequest } from "../middleware/authenticate";
import { db } from "../db/connection";
import { expenses } from "../db/schemas/expensesSchema";
import {
  uploadInvoiceToStorage,
  deleteInvoiceFromStorage,
} from "../services/storage.service";
import { downloadInvoiceFromStorage } from "../services/storage.service";

export const getExpenses = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const { search, startDate, endDate } = req.query;

    const conditions = [
      eq(expenses.business_id, businessId),
    ];

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;

      conditions.push(
        or(
          ilike(expenses.motive, term),
          ilike(expenses.supplier, term),
        )!
      );
    }

    if (startDate) {
      const date = new Date(String(startDate));

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          message: "La fecha inicial no es válida",
        });
      }

      conditions.push(gte(expenses.date, date));
    }

    if (endDate) {
      const date = new Date(String(endDate));

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          message: "La fecha final no es válida",
        });
      }

      date.setHours(23, 59, 59, 999);
      conditions.push(lte(expenses.date, date));
    }

    const result = await db
      .select()
      .from(expenses)
      .where(and(...conditions))
      .orderBy(desc(expenses.date));

    return res.status(200).json({
      expenses: result.map((expense) => ({
        ...expense,
        amount: Number(expense.amount),
      })),
    });
  } catch (error) {
    console.error("Error al obtener egresos:", error);

    return res.status(500).json({
      message: "Error al obtener los egresos",
    });
  }
};


export const createExpense = async (req: AuthRequest, res: Response) => {
  let uploadedInvoiceKey: string | null = null;

  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const motive = String(req.body?.motive ?? "").trim();
    const supplier = String(req.body?.supplier ?? "").trim();
    const amount = Number(req.body?.amount);
    const observations = String(req.body?.observations ?? "").trim();
    const rawDate = req.body?.date;
    const date = rawDate ? new Date(rawDate) : new Date();

    if (motive.length < 2 || motive.length > 255) {
      return res.status(400).json({
        message: "El motivo debe tener entre 2 y 255 caracteres",
      });
    }

    if (supplier.length < 2 || supplier.length > 150) {
      return res.status(400).json({
        message: "El proveedor debe tener entre 2 y 150 caracteres",
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "El monto debe ser mayor que cero",
      });
    }

    if (observations.length > 1000) {
      return res.status(400).json({
        message: "Las observaciones no pueden superar los 1000 caracteres",
      });
    }

    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({
        message: "La fecha no es válida",
      });
    }

    // La factura es opcional.
    if (req.file) {
      uploadedInvoiceKey = await uploadInvoiceToStorage(req.file);
    }

    const [newExpense] = await db
      .insert(expenses)
      .values({
        motive,
        supplier,
        amount: amount.toFixed(2),
        date,
        observations: observations || null,
        business_id: businessId,
        invoice_key: uploadedInvoiceKey,
      })
      .returning();

    return res.status(201).json({
      message: "Egreso registrado correctamente",
      expense: {
        ...newExpense,
        amount: Number(newExpense.amount),
      },
    });
  } catch (error) {
    console.error("Error al crear egreso:", error);

    // Si falló el registro después de subir el archivo,
    // intentamos eliminar la factura para evitar archivos huérfanos.
    if (uploadedInvoiceKey) {
      try {
        await deleteInvoiceFromStorage(uploadedInvoiceKey);
      } catch (cleanupError) {
        console.error(
          "No se pudo eliminar la factura tras el error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      message: "Error al registrar el egreso",
    });
  }
};



export const updateExpense = async (req: AuthRequest, res: Response) => {
  let uploadedInvoiceKey: string | null = null;

  try {
    const businessId = req.user?.business_id;
    const expenseId = Number(req.params.id);

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        message: "El identificador del egreso no es válido",
      });
    }

    const [existing] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.expense_id, expenseId),
          eq(expenses.business_id, businessId),
        ),
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        message: "Egreso no encontrado",
      });
    }

    const updates: Partial<typeof expenses.$inferInsert> = {};

    if (req.body?.motive !== undefined) {
      const motive = String(req.body.motive).trim();

      if (motive.length < 2 || motive.length > 255) {
        return res.status(400).json({
          message: "El motivo debe tener entre 2 y 255 caracteres",
        });
      }

      updates.motive = motive;
    }

    if (req.body?.supplier !== undefined) {
      const supplier = String(req.body.supplier).trim();

      if (supplier.length < 2 || supplier.length > 150) {
        return res.status(400).json({
          message: "El proveedor debe tener entre 2 y 150 caracteres",
        });
      }

      updates.supplier = supplier;
    }

    if (req.body?.amount !== undefined) {
      const amount = Number(req.body.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          message: "El monto debe ser mayor que cero",
        });
      }

      updates.amount = amount.toFixed(2);
    }

    if (req.body?.date !== undefined) {
      const date = new Date(req.body.date);

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          message: "La fecha no es válida",
        });
      }

      updates.date = date;
    }

    if (req.body?.observations !== undefined) {
      const observations = String(req.body.observations).trim();

      if (observations.length > 1000) {
        return res.status(400).json({
          message: "Las observaciones no pueden superar los 1000 caracteres",
        });
      }

      updates.observations = observations || null;
    }

    // Si adjunta una factura nueva, la subimos y reemplazamos la clave.
    if (req.file) {
      uploadedInvoiceKey = await uploadInvoiceToStorage(req.file);
      updates.invoice_key = uploadedInvoiceKey;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No hay datos para actualizar",
      });
    }

    const [updatedExpense] = await db
      .update(expenses)
      .set(updates)
      .where(
        and(
          eq(expenses.expense_id, expenseId),
          eq(expenses.business_id, businessId),
        ),
      )
      .returning();

    // Solo eliminamos la factura anterior después de guardar la nueva.
    if (
      uploadedInvoiceKey &&
      existing.invoice_key &&
      existing.invoice_key !== uploadedInvoiceKey
    ) {
      try {
        await deleteInvoiceFromStorage(existing.invoice_key);
      } catch (cleanupError) {
        console.error(
          "No se pudo eliminar la factura anterior:",
          cleanupError
        );
      }
    }

    return res.status(200).json({
      message: "Egreso actualizado correctamente",
      expense: {
        ...updatedExpense,
        amount: Number(updatedExpense.amount),
      },
    });
  } catch (error) {
    console.error("Error al actualizar egreso:", error);

    // Si falla la actualización, intentamos limpiar el archivo nuevo.
    if (uploadedInvoiceKey) {
      try {
        await deleteInvoiceFromStorage(uploadedInvoiceKey);
      } catch (cleanupError) {
        console.error(
          "No se pudo eliminar la factura nueva tras el error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      message: "Error al actualizar el egreso",
    });
  }
};



export const deleteExpense = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;
    const expenseId = Number(req.params.id);

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        message: "El identificador del egreso no es válido",
      });
    }

    // Buscamos el egreso y su factura, verificando el negocio.
    const [existing] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.expense_id, expenseId),
          eq(expenses.business_id, businessId),
        ),
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        message: "Egreso no encontrado",
      });
    }

    // Eliminamos primero el registro de la base de datos.
    await db
      .delete(expenses)
      .where(
        and(
          eq(expenses.expense_id, expenseId),
          eq(expenses.business_id, businessId),
        ),
      );

    // Si tenía factura, intentamos eliminarla de R2.
    if (existing.invoice_key) {
      try {
        await deleteInvoiceFromStorage(existing.invoice_key);
      } catch (storageError) {
        console.error(
          "No se pudo eliminar la factura de R2:",
          storageError
        );
      }
    }

    return res.status(200).json({
      message: "Egreso eliminado correctamente",
    });
  } catch (error) {
    console.error("Error al eliminar egreso:", error);

    return res.status(500).json({
      message: "Error al eliminar el egreso",
    });
  }
};


export const downloadExpenseInvoice = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const businessId = req.user?.business_id;
    const expenseId = Number(req.params.id);

    if (!businessId) {
      return res.status(401).json({
        message: "No se pudo identificar el negocio.",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        message: "El ID del egreso no es válido.",
      });
    }

    const [expense] = await db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.expense_id, expenseId),
          eq(expenses.business_id, businessId)
        )
      )
      .limit(1);

    if (!expense) {
      return res.status(404).json({
        message: "No se encontró el egreso.",
      });
    }

    if (!expense.invoice_key) {
      return res.status(404).json({
        message: "Este egreso no tiene una factura adjunta.",
      });
    }

    const file = await downloadInvoiceFromStorage(expense.invoice_key);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="factura-egreso-${expenseId}.pdf"`
    );
    res.setHeader("Cache-Control", "private, no-store");

    return res.send(await file.transformToByteArray());
  } catch (error) {
    console.error("Error al descargar la factura:", error);

    return res.status(500).json({
      message: "No se pudo obtener la factura.",
    });
  }
};
