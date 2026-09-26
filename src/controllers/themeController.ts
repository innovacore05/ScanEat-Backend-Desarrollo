import { Request, Response } from "express";
import { AuthRequest } from "../middleware/authenticate";
import {
    getThemeByBusinessId,
    saveTheme,
    getThemeByTableId,
    saveThemeLogo,
} from "../services/theme.service";
import {
    updateRestaurantThemeSchema,
} from "../db/schemas/restaurantThemeSchema";
import { uploadImageToStorage } from "../services/storage.service";



export const getRestaurantTheme = async (
    req: AuthRequest,
    res: Response,
) => {
    try {
        const businessId = Number(req.params.businessId);

        if (!Number.isInteger(businessId) || businessId <= 0) {
            return res.status(400).json({
                message: "El identificador del negocio no es válido",
            });
        }

        if (req.user?.business_id !== businessId) {
            return res.status(403).json({
                message: "No tienes permiso para consultar este negocio",
            });
        }

        const theme = await getThemeByBusinessId(businessId);

        return res.status(200).json(theme);
    } catch (error) {
        console.error("Error obteniendo el tema:", error);

        return res.status(500).json({
            message: "No se pudo obtener la personalización",
        });
    }
};

export const updateRestaurantTheme = async (
    req: AuthRequest,
    res: Response,
) => {
    try {
        const businessId = Number(req.params.businessId);

        if (!Number.isInteger(businessId) || businessId <= 0) {
            return res.status(400).json({
                message: "El identificador del negocio no es válido",
            });
        }

        if (req.user?.business_id !== businessId) {
            return res.status(403).json({
                message: "No tienes permiso para modificar este negocio",
            });
        }

        const parsed = updateRestaurantThemeSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                message: "Los datos del tema no son válidos",
                errors: parsed.error.flatten(),
            });
        }

        const theme = await saveTheme(businessId, parsed.data);

        return res.status(200).json(theme);
    } catch (error) {
        console.error("Error actualizando el tema:", error);

        return res.status(500).json({
            message: "No se pudo guardar la personalización",
        });
    }
};
export const getPublicRestaurantTheme = async (
    req: Request,
    res: Response,
) => {
    try {
        const tableId = req.params.tableId;

        if (typeof tableId !== "string" || !tableId) {
            return res.status(400).json({
                message: "El identificador de mesa es obligatorio",
            });
        }

        const theme = await getThemeByTableId(tableId);

        if (!theme) {
            return res.status(404).json({
                message: "Mesa no encontrada",
            });
        }

        return res.status(200).json(theme);
    } catch (error) {
        console.error("Error obteniendo el tema público:", error);

        return res.status(500).json({
            message: "No se pudo obtener el tema del restaurante",
        });
    }
};

export const uploadRestaurantLogo = async (
    req: AuthRequest,
    res: Response,
) => {
    try {
        const businessId = Number(req.params.businessId);

        if (!Number.isInteger(businessId) || businessId <= 0) {
            return res.status(400).json({
                message: "El identificador del negocio no es válido",
            });
        }

        if (req.user?.business_id !== businessId) {
            return res.status(403).json({
                message: "No tienes permiso para modificar este negocio",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                message: "Debes seleccionar un logo",
            });
        }

        const logoUrl = await uploadImageToStorage(
            req.file,
            `businesses/${businessId}/logos`,
        );

        await saveThemeLogo(businessId, logoUrl);

        return res.status(200).json({
            logoUrl,
        });
    } catch (error) {
        console.error("Error subiendo el logo:", error);

        return res.status(500).json({
            message: "No se pudo subir el logo",
        });
    }
};