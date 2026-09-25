import { Request, Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { users } from "../db/schemas/userSchema";

const userFields = {
  userId: users.user_id,
  firstName: users.first_name,
  lastName: users.last_name,
  email: users.email,
  roleId: users.role_id,
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const userList = await db
      .select(userFields)
      .from(users)
      .where(eq(users.business_id, businessId))
      .orderBy(users.user_id);

    return res.status(200).json({ users: userList });
  } catch (error) {
    console.error("Error obteniendo usuarios:", error);

    return res.status(500).json({
      message: "No se pudieron obtener los usuarios",
    });
  }
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }
    const [user] = await db
      .select(userFields)
      .from(users)
      .where(
        and(
          eq(users.user_id, userId),
          eq(users.business_id, businessId)
        )
      )
      .limit(1);

    if (!user) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error("Error obteniendo usuario:", error);

    return res.status(500).json({
      message: "No se pudo obtener el usuario",
    });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }
    const { first_name, last_name, email, role_id } = req.body;
    const changes: Partial<typeof users.$inferInsert> = {};

    if (first_name !== undefined) changes.first_name = first_name.trim();
    if (last_name !== undefined) changes.last_name = last_name.trim();
    if (email !== undefined) changes.email = email.trim().toLowerCase();
    if (role_id !== undefined) changes.role_id = role_id;

    if (changes.email !== undefined) {
      const [existingUser] = await db
        .select({ userId: users.user_id })
        .from(users)
        .where(
          and(
            sql`LOWER(${users.email}) = LOWER(${changes.email})`,
            sql`${users.user_id} <> ${userId}`,
          ),
        )
        .limit(1);

      if (existingUser) {
        return res.status(409).json({
          message: "Este correo ya está registrado",
        });
      }
    }
    const [targetUser] = await db
      .select({ userId: users.user_id })
      .from(users)
      .where(
        and(
          eq(users.user_id, userId),
          eq(users.business_id, businessId)
        )
      )
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    const [updatedUser] = await db
      .update(users)
      .set(changes)
      .where(
        and(
          eq(users.user_id, userId),
          eq(users.business_id, businessId)
        )
      )
      .returning(userFields);

    if (!updatedUser) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    return res.status(200).json({
      message: "Usuario actualizado correctamente",
      user: updatedUser,
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({
        message: "Este correo ya está registrado",
      });
    }

    console.error("Error actualizando usuario:", error);

    return res.status(500).json({
      message: "No se pudo actualizar el usuario",
    });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        message: "El usuario no tiene un negocio asociado",
      });
    }
    const [deletedUser] = await db
      .delete(users)
      .where(
        and(
          eq(users.user_id, userId),
          eq(users.business_id, businessId)
        )
      )
      .returning({ userId: users.user_id });
    if (!deletedUser) {
      return res.status(404).json({
        message: "Usuario no encontrado",
      });
    }

    return res.status(200).json({
      message: "Usuario eliminado correctamente",
    });
  } catch (error) {
    console.error("Error eliminando usuario:", error);

    return res.status(500).json({
      message: "No se pudo eliminar el usuario",
    });
  }
};
