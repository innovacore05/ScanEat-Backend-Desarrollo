import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY no está configurada");
}

export const gemini = new GoogleGenAI({
  apiKey,
});

//Este es el tipo de datos que se envía a Gemini para generar el reporte de ventas.
// Contiene el periodo de tiempo, un resumen de las ventas, el producto más vendido, las horas pico y los pedidos cancelados.
export type SalesReportInput = {
  period: string;

  summary: {
    totalSales: number;
    totalOrders: number;
    averageOrder: number;
  };

  bestProduct: {
    productId: number;
    name: string;
    quantity: number;
  } | null;

  peakHours: {
    hour: number;
    orders: number;
  }[];

  cancellations: {
    total: number;
    rate: number;
  };
};

//Este es el tipo de datos que se recibe de Gemini después de generar el reporte de ventas.
export type SalesReportAI = {
  summary: string;
  bestProduct: string;
  peakHours: string;
  cancellations: string;
  recommendation: string;
};

// Función para probar la conexión con Gemini
export const testGeminiConnection = async () => {
  const response = await gemini.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: "Responde únicamente: Gemini funciona correctamente.",
  });

  return response.text;
};

// Función para generar el reporte de ventas utilizando Gemini
// Esta función recibe los datos de ventas y genera un análisis utilizando el modelo de lenguaje de Gemini.
//Aquí se construye el prompt que se envía a Gemini, y se espera una respuesta en formato JSON con las propiedades especificadas.
// Se lanza un error si la respuesta no es válida o no es JSON.
//Devuelve un objeto con las propiedades summary, bestProduct, peakHours, cancellations y recommendation.
export const generateSalesReport = async (
  data: SalesReportInput,
): Promise<SalesReportAI> => {
  const prompt = `
Eres un asistente de análisis de ventas para un sistema de restaurantes.

Analiza los siguientes datos reales de ventas:

${JSON.stringify(data, null, 2)}

Genera un análisis breve y claro para el administrador del restaurante.

Debes devolver exactamente estas cinco propiedades:

summary:
Un resumen general del comportamiento de las ventas.

bestProduct:
Explica cuál fue el producto más vendido y qué significa este resultado.

peakHours:
Explica cuáles fueron las horas con mayor cantidad de pedidos.

cancellations:
Analiza los pedidos cancelados y su porcentaje.

recommendation:
Da UNA recomendación práctica para mejorar las ventas o la operación del restaurante.

No inventes datos.
No agregues información que no esté presente en los datos.
No utilices markdown.
Responde únicamente con un objeto JSON válido.
`;

  const response = await gemini.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("Gemini no devolvió una respuesta");
  }

  try {
    return JSON.parse(text) as SalesReportAI;
  } catch {
    throw new Error("Gemini devolvió una respuesta que no es JSON válido");
  }
};

