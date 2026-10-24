import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection";
import { Request, Response } from "express";
import type { AuthRequest } from "../middleware/authenticate";
import { generateSalesReport, testGeminiConnection, type SalesReportInput } from "../services/geminiService";
import {
  buildSalesAnalytics,
} from "./orderController";
import { tables } from "../db/schemas/mesaSchema";
import { categories, products } from "../db/schemas/adminMenuSchema";
import { recommendMenu } from "../services/geminiService";

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


const menuChatBodySchema = z.object({
  mesaId: z.uuid(),
  message: z.string().trim().min(1).max(1000),
  budget: z.number().positive().optional(),
});

const extractBudget = (message: string): number | undefined => {
  const match = message.match(
    /(?:presupuesto|tengo|puedo gastar|quiero gastar|cuento con|dispongo de)[^0-9₡]{0,20}₡?\s*([\d.,]+)\s*(mil|k)?/i,
  );

  if (!match) return undefined;

  let amountText = match[1];

  // "10.000" o "10,000" significa diez mil.
  if (/[.,]\d{3}$/.test(amountText)) {
    amountText = amountText.replace(/[.,]/g, "");
  } else {
    amountText = amountText.replace(",", ".");
  }

  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  return amount * (match[2] ? 1000 : 1);
};

export const createMenuChat = async (
  req: Request,
  res: Response,
) => {
  try {
    const parsedBody = menuChatBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
      return res.status(400).json({
        message:
          "Envía un mesaId válido, un mensaje y el presupuesto como número.",
      });
    }

    const { mesaId, message, budget } = parsedBody.data;

    // Si no se proporciona un presupuesto, intenta extraerlo del mensaje.
    const finalBudget = budget ?? extractBudget(message);

    // Averigua a qué restaurante pertenece la mesa.
    const [table] = await db
      .select({
        businessId: tables.businessId,
      })
      .from(tables)
      .where(
        and(
          eq(tables.id, mesaId),
          eq(tables.active, true),
        ),
      )
      .limit(1);

    if (!table) {
      return res.status(404).json({
        message: "No encontramos una mesa activa con ese identificador.",
      });
    }

    // Carga todos los platillos de ese restaurante.
    const menuRows = await db
      .select({
        productId: products.productId,
        productName: products.productName,
        description: products.description,
        price: products.price,
        discount: products.discount,
        categoryName: categories.name,
      })
      .from(products)
      .innerJoin(
        categories,
        eq(products.categoryId, categories.categoryId),
      )
      .where(eq(products.businessId, table.businessId));

    if (menuRows.length === 0) {
      return res.status(200).json({
        reply: "Todavía no hay platillos disponibles en este menú.",
        recommendations: [],
      });
    }

    // Calcula el precio con descuento usando los datos del servidor.
    const menu = menuRows.map((product) => {
      const originalPrice = Number(product.price);
      const discount = Number(product.discount ?? 0);
      const finalPrice = Math.round(
        originalPrice * (1 - discount / 100) * 100,
      ) / 100;

      return {
        productId: product.productId,
        productName: product.productName,
        description: product.description ?? "",
        categoryName: product.categoryName,
        price: finalPrice,
      };
    });

    const aiResult = await recommendMenu(message, menu, finalBudget);

const validItems = aiResult.recommendations
  .map((recommendation) => {
    const product = menu.find(
      (item) => item.productId === recommendation.productId,
    );

    if (!product) return null;

    return {
      ...product,
      role: recommendation.role,
      reason: recommendation.reason,
    };
  })
  .filter((item) => item !== null);

const meal = validItems.find((item) => item.role === "meal");

if (!meal || (finalBudget !== undefined && meal.price > finalBudget)) {
  return res.status(200).json({
    reply: "No encontré una comida adecuada dentro de tu presupuesto en este momento.",
    recommendations: [],
  });
}

const recommendations = [meal];
let remainingBudget =
  finalBudget === undefined
    ? Number.POSITIVE_INFINITY
    : finalBudget - meal.price;

for (const role of ["drink", "dessert"] as const) {
  const product = validItems.find((item) => item.role === role);

  if (product && product.price <= remainingBudget) {
    recommendations.push(product);
    remainingBudget -= product.price;
  }
}

return res.status(200).json({
  reply: aiResult.reply,
  recommendations,
});
} catch (error) {
  console.error("Error en el chat del menú:", error);

  return res.status(500).json({
    message: "No se pudo obtener una recomendación en este momento.",
  });
}
};