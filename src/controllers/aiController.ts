import { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authenticate";
import { generateSalesReport, testGeminiConnection, type SalesReportInput } from "../services/geminiService";
import {
  buildSalesAnalytics,
} from "./orderController";

export const testGemini = async (
  _req: Request,
  res: Response,
) => {
  try {
    const response = await testGeminiConnection();

    return res.status(200).json({
      success: true,
      message: response,
    });
  } catch (error) {
    console.error("Error probando Gemini:", error);

    return res.status(500).json({
      success: false,
      message: "No se pudo conectar con Gemini",
    });
  }
};

// Controlador para generar el reporte de ventas utilizando Gemini
export const createSalesReport = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const businessId = req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "El usuario no tiene un negocio asociado",
      });
    }

    const rawPeriod = req.body?.period;

    const period =
      typeof rawPeriod === "string"
        ? rawPeriod.toLowerCase()
        : "today";

    if (
      period !== "today" &&
      period !== "week" &&
      period !== "month" &&
      period !== "year"
    ) {
      return res.status(400).json({
        success: false,
        message: "Periodo no válido",
      });
    }

    const analytics = await buildSalesAnalytics(
      businessId,
      period,
    );

    const report = await generateSalesReport({
      period: analytics.period,

      summary: analytics.summary,

      bestProduct: analytics.bestProduct,

      peakHours: analytics.peakHours,

      cancellations: analytics.cancellations,
    });

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (error) {
    console.error(
      "Error generando reporte con Gemini:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "No se pudo generar el reporte con IA",
    });
  }
};

