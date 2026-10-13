import { Request, Response } from "express";
import {
  fetchFamilyOptions,
  isFiscalType,
  searchFamilyOptions,
  SEARCH_FAMILIES,
} from "../services/cabys.service";

// GET /fiscal-options?type=hot_drinks
export const getFiscalOptions = async (req: Request, res: Response) => {
  try {
    const fiscalType = String(req.query.type ?? "");

    if (!isFiscalType(fiscalType)) {
      return res.status(400).json({ message: "El tipo fiscal no es válido" });
    }

    // dishes y packaged no cargan lista: uno usa código por defecto, el otro busca
    if (fiscalType === "dishes" || SEARCH_FAMILIES[fiscalType] !== undefined) {
      return res.status(200).json([]);
    }

    const options = await fetchFamilyOptions(fiscalType);

    return res.status(200).json(
      options.map(({ code, label, ivaRate }) => ({ code, label, ivaRate })),
    );
  } catch (error) {
    console.error("Error fetching fiscal options:", error);
    return res
      .status(502)
      .json({ message: "No se pudieron cargar las opciones CABYS" });
  }
};

// GET /cabys/search?q=chicle&type=packaged
export const searchCabys = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const type = String(req.query.type ?? "");

    if (q.length < 3) {
      return res.status(400).json({
        message: "Escribe al menos 3 caracteres para buscar CABYS",
      });
    }

    if (!isFiscalType(type) || SEARCH_FAMILIES[type] === undefined) {
      return res.status(400).json({
        message: "Este tipo de categoría no usa búsqueda CABYS",
      });
    }

    const options = await searchFamilyOptions(type, q, 10);

    return res.status(200).json(
      options.map(({ code, label, ivaRate }) => ({ code, label, ivaRate })),
    );
  } catch (error) {
    console.error("Error al buscar CABYS:", error);
    return res.status(502).json({
      message: "Ocurrió un error al consultar el catálogo CABYS",
    });
  }
};