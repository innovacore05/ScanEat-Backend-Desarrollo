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
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(1000),
    }),
  ).max(20).default([]),
});

const extractBudget = (message: string): number | undefined => {
  const match = message.match(
    /(?:presupuesto|tengo|puedo gastar|quiero gastar|cuento con|dispongo de|traigo)[^0-9₡]{0,20}₡?\s*([\d.,]+)\s*(mil|k)?/i,
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

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

const hasOrderIntent = (message: string) =>
  /\b(quiero|quisiera|me gustaría|me gustaria|deseo|voy a|tomar|comer|pedir|agregar|agregame|ponme|dame)\b/i.test(
    message,
  );

const inferMenuRole = (
  product: {
    productName: string;
    description: string;
    categoryName: string;
  },
): "meal" | "drink" | "dessert" => {
  const text = normalizeText(
    `${product.productName} ${product.description} ${product.categoryName}`,
  );

  if (
    /\b(cafe|café|batido|bebida|refresco|jugo|te|té|matcha|smoothie|agua)\b/i.test(
      text,
    )
  ) {
    return "drink";
  }

  if (
    /\b(postre|dulce|helado|queque|pastel|crepa|brownie|flan)\b/i.test(
      text,
    )
  ) {
    return "dessert";
  }

  return "meal";
};

const isMealMomentRequest = (message: string) =>
  /\b(desayuno|desayunar|almuerzo|almorzar|cena|cenar)\b/i.test(message);

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

    const { mesaId, message, budget, history } = parsedBody.data;

    const greetingPattern =
      /^(hola|buenas|buenos días|buenas tardes|buenas noches|hey)\b/i;

    if (greetingPattern.test(message)) {
      return res.status(200).json({
        reply:
          "¡Hola! ¿Qué te gustaría comer o beber hoy? También puedo ayudarte según tu presupuesto.",
        recommendations: [],
        action: { type: "none" },
      });
    }

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
        action: { type: "none" },
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
        originalPrice,
        discount,
      };
    });

    const aiResult = await recommendMenu(
      message,
      menu,
      finalBudget,
      history,
    );

    const aiItems = aiResult.recommendations
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

    const affordableMenu =
      finalBudget === undefined
        ? menu
        : menu.filter((item) => item.price <= finalBudget);

    const requestedMealMoment =
      /\b(desayuno|desayunar|almuerzo|almorzar|cena|cenar|comida|plato fuerte)\b/i.test(
        message,
      );
    const normalizedMessage = normalizeText(message);
    const explicitlyRequestedProduct = menu.find((item) =>
      normalizedMessage.includes(normalizeText(item.productName)),
    );

    const fallbackItems = affordableMenu
      .filter((item) => {
        if (!requestedMealMoment) return true;

        return inferMenuRole(item) === "meal";
      })
      .slice(0, 5)
      .map((item) => ({
        ...item,
        role: inferMenuRole(item),
        reason: "Está disponible dentro de tu presupuesto.",
      }));

    const validItems = aiItems.length > 0 ? aiItems : fallbackItems;

    const validAction = (() => {
      const action = aiResult.action;

      if (action.type === "confirm_add_to_cart") {
        const product = menu.find(
          (item) => item.productId === action.productId,
        );

        if (!product) {
          return { type: "none" as const };
        }

        return {
          type: "confirm_add_to_cart" as const,
          productId: product.productId,
          productName: product.productName,
          quantity:
            Number.isInteger(action.quantity) && action.quantity > 0
              ? action.quantity
              : 1,
        };
      }

      if (hasOrderIntent(message)) {
        if (explicitlyRequestedProduct) {
          return {
            type: "confirm_add_to_cart" as const,
            productId: explicitlyRequestedProduct.productId,
            productName: explicitlyRequestedProduct.productName,
            quantity: 1,
          };
        }
      }

      return { type: "none" as const };
    })();

    const asksCompleteMeal =
      /\b(combo|completo|completa|comida completa|comida con bebida|comida con postre)\b/i.test(
        message,
      );

    const asksOnlyDrink =
      /\b(solo|únicamente|un|una)?\s*(café|cafe|bebida|batido|refresco|jugo)\b/i.test(
        message,
      );

    const asksOnlyDessert =
      /\b(solo|únicamente|un|una)?\s*(postre|helado|queque|pastel)\b/i.test(
        message,
      );

    const asksOnlyMeal =
      /\b(solo|únicamente)\s+(una?\s+)?(comida|plato fuerte|almuerzo|cena|desayuno)\b/i.test(
        message,
      );

    const affordableItems =
      finalBudget === undefined
        ? validItems
        : validItems.filter((item) => item.price <= finalBudget);

    const classifiedAffordableMenu = (finalBudget === undefined
      ? menu
      : menu.filter((item) => item.price <= finalBudget)
    ).map((item) => ({
      ...item,
      role: inferMenuRole(item),
      reason: "Está disponible dentro de tu presupuesto.",
    }));

    const classifiedAffordableItems = affordableItems.map((item) => ({
      ...item,
      role: inferMenuRole(item),
    }));

    let recommendations = validItems;

    if (explicitlyRequestedProduct) {
      const requestedProduct = classifiedAffordableMenu.find(
        (item) => item.productId === explicitlyRequestedProduct.productId,
      );
      recommendations = requestedProduct ? [requestedProduct] : [];
    } else if (asksOnlyDrink) {
      recommendations = classifiedAffordableItems.filter(
        (item) => item.role === "drink",
      );
    } else if (asksOnlyDessert) {
      recommendations = classifiedAffordableItems.filter(
        (item) => item.role === "dessert",
      );
    } else if (asksOnlyMeal) {
      recommendations = classifiedAffordableItems.filter(
        (item) => item.role === "meal",
      );
    } else if (asksCompleteMeal || isMealMomentRequest(message)) {
      const mealCandidates = classifiedAffordableMenu.filter(
        (item) => item.role === "meal",
      );
      const drinkCandidates = classifiedAffordableMenu.filter(
        (item) => item.role === "drink",
      );
      const dessertCandidates = classifiedAffordableMenu.filter(
        (item) => item.role === "dessert",
      );
      const meal = mealCandidates[0];

      if (meal) {
        recommendations = [meal];

        let remainingBudget =
          finalBudget === undefined
            ? Number.POSITIVE_INFINITY
            : finalBudget - meal.price;

        const recommendationRoles = asksCompleteMeal
          ? (["drink", "dessert"] as const)
          : (["drink"] as const);

        for (const role of recommendationRoles) {
          const candidates =
            role === "drink" ? drinkCandidates : dessertCandidates;
          const product = candidates.find(
            (item) =>
              item.price <= remainingBudget &&
              !recommendations.some(
                (recommended) => recommended.productId === item.productId,
              ),
          );

          if (product) {
            recommendations.push(product);
            remainingBudget -= product.price;
          }
        }
      } else {
        // No existe una comida completa dentro del presupuesto.
        recommendations = classifiedAffordableMenu.filter(
          (item) =>
            item.role === "drink" ||
            item.role === "dessert",
        );
      }
    } else if (finalBudget !== undefined) {
      // Conversación normal con presupuesto: solo mostrar productos que caben.
      recommendations = affordableItems;
    }

    if (isMealMomentRequest(message) && !asksCompleteMeal) {
      recommendations = recommendations.filter((item) => item.role !== "dessert");
    }

    let reply = aiResult.reply;

    if (
      asksCompleteMeal &&
      !classifiedAffordableMenu.some((item) => item.role === "meal")
    ) {
      reply =
        "No encontramos una comida completa dentro de tu presupuesto, " +
        "pero sí podemos ofrecerte estas opciones individuales.";
    }

    if (finalBudget !== undefined && recommendations.length === 0) {
      reply =
        "No encontramos opciones dentro de tu presupuesto. " +
        "¿Quieres que busquemos algo con un presupuesto diferente?";
    } else if (
      finalBudget !== undefined &&
      recommendations.length > 0 &&
      /no encontr|sin opciones|no hay opciones|no puedo recomendar/i.test(reply)
    ) {
      reply = requestedMealMoment
        ? `Encontré estas opciones para tu solicitud dentro de tu presupuesto de ₡${finalBudget}.`
        : `Encontré estas opciones dentro de tu presupuesto de ₡${finalBudget}.`;
    }

    const responseReply =
      validAction.type === "confirm_add_to_cart" &&
      aiResult.action.type !== "confirm_add_to_cart"
        ? `Encontré ${validAction.productName}. ¿Quieres que agregue ${validAction.productName} a la orden?`
        : (isMealMomentRequest(message) && recommendations.length > 0
          ? `Para tu solicitud te recomiendo ${recommendations
              .map((item) => item.productName)
              .join(" y ")}.`
          : reply);

    return res.status(200).json({
      reply: responseReply,
      recommendations,
      action: validAction,
    });

  } catch (error) {
    console.error("Error en el chat del menú:", error);
    if (error instanceof Error) {
      console.error("Mensaje del error:", error.message);
      console.error("Stack del error:", error.stack);
    } else {
      console.error("Error no estándar:", JSON.stringify(error));
    }

    return res.status(500).json({
      message: "No se pudo obtener una recomendación en este momento.",
    });
  }
};
