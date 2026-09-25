import { Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import { users } from "../db/schemas/userSchema";
import { businesses } from "../db/schemas/userSchema";
import { db } from "../db/connection";
import { eq } from "drizzle-orm";

export const createBusiness = async (req: AuthRequest, res: Response) => {
    try {
        const { name, email, number, code } = req.body;

        const adminId = req.user?.user_id;

        if (!adminId) {
            return res.status(401).json({
                message: "Usuario no autenticado",
            });
        }

        const [existingBusiness] = await db
            .select({ businessId: businesses.business_id })
            .from(businesses)
            .where(eq(businesses.admin_id, adminId))
            .limit(1);

        if (existingBusiness) {
            return res.status(409).json({
                message: "Este usuario ya tiene un negocio registrado",
            });
        }

        const [business] = await db
            .insert(businesses)
            .values({
                name,
                email,
                number,
                code,
                admin_id: adminId,
            })
            .returning();

        await db
            .update(users)
            .set({
                business_id: business.business_id,
            })
            .where(eq(users.user_id, adminId));

        return res.status(201).json({
            message: "Negocio creado correctamente",
            business,
        });

    } catch (error) {
        console.error("Error al crear negocio:", error);

        if (
            error instanceof Error &&
            error.message.includes("unique_business_admin")
        ) {
            return res.status(409).json({
                message: "Este usuario ya tiene un negocio registrado",
            });
        }

        return res.status(500).json({
            message: "Error al crear el negocio",
        });
    }
};