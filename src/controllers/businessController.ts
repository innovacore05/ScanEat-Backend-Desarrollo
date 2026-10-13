import { Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import { users } from "../db/schemas/userSchema";
import { businesses } from "../db/schemas/userSchema";
import { db } from "../db/connection";
import { eq } from "drizzle-orm";
import { randomInt } from "node:crypto";

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

        const [existingCode] = await db
            .select({
                businessId: businesses.business_id,
            })
            .from(businesses)
            .where(eq(businesses.code, code))
            .limit(1);

        if (existingCode) {
            return res.status(409).json({
                message: "Este código ya está registrado. Genera uno nuevo.",
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

    } catch (error: unknown) {
        console.error("Error al crear negocio:", error);

        if (error && typeof error === "object") {
            const dbError = error as {
                code?: string;
                constraint?: string;
                message?: string;
            };

            if (
                dbError.constraint === "unique_business_admin" ||
                dbError.message?.includes("unique_business_admin")
            ) {
                return res.status(409).json({
                    message: "Este usuario ya tiene un negocio registrado",
                });
            }

            if (
                dbError.code === "23505" &&
                (
                    dbError.constraint === "businesses_code_key" ||
                    dbError.constraint?.toLowerCase().includes("code")
                )
            ) {
                return res.status(409).json({
                    message: "Este código ya está registrado. Genera uno nuevo.",
                });
            }
        }

        return res.status(500).json({
            message: "Error al crear el negocio",
        });
    }
};

export const updateBusiness = async (req: AuthRequest, res: Response) => {
    try {
        const { name, email, number } = req.body;

        const adminId = req.user?.user_id;

        if (!adminId) {
            return res.status(401).json({
                message: "Usuario no autenticado",
            });
        }

        const [business] = await db
            .select({
                businessId: businesses.business_id,
            })
            .from(businesses)
            .where(eq(businesses.admin_id, adminId))
            .limit(1);

        if (!business) {
            return res.status(404).json({
                message: "No se encontró el negocio.",
            });
        }

        const [updatedBusiness] = await db
            .update(businesses)
            .set({
                name,
                email,
                number,
            })
            .where(eq(businesses.business_id, business.businessId))
            .returning();

        return res.status(200).json({
            message: "Negocio actualizado correctamente",
            business: updatedBusiness,
        });
    } catch (error) {
        console.error("Error al actualizar negocio:", error);

        return res.status(500).json({
            message: "Error al actualizar el negocio",
        });
    }
};

export const generateBusinessCode = async (
    req: AuthRequest,
    res: Response
) => {
    try {
        const adminId = req.user?.user_id;

        if (!adminId) {
            return res.status(401).json({
                message: "Usuario no autenticado",
            });
        }

        // Verificar que el usuario todavía no tenga un negocio.
        const [existingBusiness] = await db
            .select({
                businessId: businesses.business_id,
            })
            .from(businesses)
            .where(eq(businesses.admin_id, adminId))
            .limit(1);

        if (existingBusiness) {
            return res.status(409).json({
                message: "Este usuario ya tiene un negocio registrado",
            });
        }

        const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";

        // Intentar generar un código que no esté registrado.
        for (let attempt = 0; attempt < 20; attempt++) {
            let code = "";

            for (let i = 0; i < 4; i++) {
                code += letters[randomInt(letters.length)];
            }

            for (let i = 0; i < 4; i++) {
                code += randomInt(10).toString();
            }

            const [existingCode] = await db
                .select({
                    businessId: businesses.business_id,
                })
                .from(businesses)
                .where(eq(businesses.code, code))
                .limit(1);

            if (!existingCode) {
                return res.status(200).json({ code });
            }
        }

        return res.status(503).json({
            message: "No se pudo generar un código disponible. Inténtalo de nuevo.",
        });
    } catch (error) {
        console.error("Error al generar código:", error);

        return res.status(500).json({
            message: "Error al generar el código del negocio",
        });
    }
};