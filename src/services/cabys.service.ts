import { FISCAL_TYPES, type FiscalType } from "../db/schemas/adminMenuSchema";

export const isFiscalType = (value: unknown): value is FiscalType =>
  typeof value === "string" &&
  (FISCAL_TYPES as readonly string[]).includes(value);

// código cabys por defecto para restaurantes con mesero
const DEFAULT_DISH_CABYS_CODE = "6331000000000";

const IVA_RATE_CODES = new Map<number, string>([
  [1, "02"],
  [2, "03"],
  [4, "04"],
  [13, "08"],
  [0.5, "09"],
]);

const CABYS_API_URL = 
"https://api.facturaencr.com/v2/efactura/catalogs/cabys";


// La API documenta top de 1 a 50
const CABYS_MAX_TOP = 50;


type FacturaEnCrCabysItem = {
  codigo: string;
  descripcion: string;
  impuesto: number | string;
};

export type CabysOption = {
  code: string;
  label: string;
  ivaRate: number;
  ivaRateCode: string;
};

// Familias con lista automática: qué se consulta y qué prefijos se aceptan
const FAMILY_CONFIG: Partial<
  Record<FiscalType, { query: string; prefixes: string[] }>
> = {
  hot_drinks: { query: "634", prefixes: ["6340001"] },
  alcohol_drinks: { query: "634", prefixes: ["634000201"] },
  cold_drinks: { query: "634", prefixes: ["634000202"] },
};

//que familias usan el endpoint de busqueda escrita? 
export const SEARCH_FAMILIES: Partial<Record<FiscalType, true>> = {
  packaged: true,
};



const FAMILY_CACHE_MS = 6 * 60 * 60 * 1000;
const familyCache = new Map<
FiscalType, { at: number; items: CabysOption[] }>();

const cleanLabel = (description: string) =>
  description
    .replace(
      /,\s*vendid[oa]s?\s+en restaurantes, bares y establecimientos similares/i,
      "",
    )
    .replace(/,\s*n\.c\.p\.?$/i, " (otros)")
    .trim();

const requestCabys = async (
  query: string,
  requestedTop = 30,
): Promise<FacturaEnCrCabysItem[]> => {
  const apiKey = process.env.FACTURAENCR_API_KEY;
  const apiSecret = process.env.FACTURAENCR_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("Faltan las credenciales CABYS del servidor");
  }

 const top = Math.min(
    Math.max(Math.floor(requestedTop), 1),
    CABYS_MAX_TOP,
  );

  const url = new URL(CABYS_API_URL);
  url.searchParams.set("q", query);
url.searchParams.set("top", String(top));



  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Factura en CR respondió ${response.status}`);
  }

  const body = (await response.json()) as { items?: FacturaEnCrCabysItem[] };
  return body.items ?? [];
};

// Convierte items de la API; descarta tarifas sin
//regla fiscal definida
const toOptions = (
  items: FacturaEnCrCabysItem[],
  prefixes: string[],
  formatLabel: (description: string) => string,
  sortByCode: boolean,
): CabysOption[] =>{
    const options =items
    .filter(
      (item) =>
        prefixes.length === 0 ||
        prefixes.some((prefix) => item.codigo.startsWith(prefix)),
    )
   .flatMap((item) => {
  if (!/^\d{13}$/.test(item.codigo)) return [];

  // excluir CABYS con IVA 0 %  o tarifa invalida
  const ivaRate = Number(item.impuesto);

  if (!Number.isFinite(ivaRate) || ivaRate <= 0 || ivaRate > 100) {
    return [];
  }

  const ivaRateCode = IVA_RATE_CODES.get(ivaRate);

  // Excluir  tarifas  no soportadas
  if (!ivaRateCode) return [];

  return [
    {
      code: item.codigo,
      label: formatLabel(item.descripcion),
      ivaRate,
      ivaRateCode,
    },
  ];
});
   return sortByCode
    ? options.sort((a, b) => a.code.localeCompare(b.code))
    : options;
};
// Lista automatica (bebidas)
export const fetchFamilyOptions = async (
  fiscalType: FiscalType,
): Promise<CabysOption[]> => {
  const config = FAMILY_CONFIG[fiscalType];
  if (!config) return [];

  const cached = familyCache.get(fiscalType);
  if (cached && Date.now() - cached.at < FAMILY_CACHE_MS) {
    return cached.items;
  }

  const items = toOptions(
    await requestCabys(config.query, CABYS_MAX_TOP),
    config.prefixes,
    cleanLabel,
    true,
  );

  if (items.length > 0) {
    familyCache.set(fiscalType, { at: Date.now(), items });
  }
  return items;
};

//limites y filtros de la busqueda de productos
type PackagedSearchRule = {
  matches: RegExp;
  apiQueries: string[];
  descriptionMatches: RegExp;
};

const PACKAGED_SEARCH_RULES: PackagedSearchRule[] = [
  {
    matches: /\b(papita|papitas|papa|papas|chips|snack|snacks|maiz)\b/,
    apiQueries: ["snacks", "bocadillos de maíz", "bocadillos de cereales"],
    descriptionMatches: /(snack|bocadillo|abreboca)/,
  },
  {
    matches: /\b(galleta|galletas)\b/,
    apiQueries: ["galletas"],
    descriptionMatches: /gallet/,
  },
  {
    matches: /\b(chicle|chicles|goma de mascar)\b/,
    apiQueries: ["chicles", "gomas de mascar"],
    descriptionMatches: /(chicle|goma de mascar)/,
  },
  {
    matches: /\b(dulce|dulces|confite|confites|caramelo|caramelos|bombon|bombones)\b/,
    apiQueries: ["confites", "caramelos", "bombones"],
    descriptionMatches: /(confite|caramelo|pastilla|bombon|goma azucarada)/,
  },
  {
   matches: /\b(agua|agua embotellada|agua envasada|agua mineral)\b/,
  apiQueries: ["agua embotellada"],
  descriptionMatches: /(agua embotellada|agua envasada|agua mineral)/, 
},
  {
    matches:
    /\b(bebida|bebidas|gaseosa|gaseosas|refresco|refrescos|soda|botella|botellas|embotellada|embotelladas|envasada|envasadas)\b/,
  apiQueries: ["bebidas gaseosas", "refrescos", "bebidas no alcohólicas"],
  descriptionMatches: /(bebida|gaseosa|refresco|soda)/,
},

//chocolates
 {
    matches: /\b(chocolate puro|cacao puro)\b/,
    apiQueries: ["chocolate puro", "cacao puro"],
    descriptionMatches: /(chocolate puro|cacao puro|100 ?%.*cacao)/,
  },
  {
   
    matches: /\b(chocolate con leche|chocolate de leche)\b/,
    apiQueries: ["chocolate con leche"],
    descriptionMatches: /chocolate con leche/,
  },
  {
  
    matches: /\b(chocolate negro con relleno|chocolate oscuro con relleno)\b/,
    apiQueries: ["chocolate negro con relleno", "chocolate oscuro con relleno"],
    descriptionMatches: /(chocolate negro con relleno|chocolate oscuro con relleno)/,
  },
  {
   
    matches: /\b(chocolate negro sin relleno|chocolate oscuro sin relleno)\b/,
    apiQueries: ["chocolate negro sin relleno", "chocolate oscuro sin relleno"],
    descriptionMatches: /(chocolate negro sin relleno|chocolate oscuro sin relleno)/,
  },
  {
    
    matches: /\b(chocolate negro|chocolate oscuro|chocolate amargo)\b/,
    apiQueries: ["chocolate negro", "chocolate oscuro", "chocolate amargo"],
    descriptionMatches: /(chocolate negro|chocolate oscuro|chocolate amargo)/,
  },
  {
    
    matches: /\b(chocolate blanco)\b/,
    apiQueries: ["chocolate blanco"],
    descriptionMatches: /chocolate blanco/,
  },
  {
   
    matches: /\b(chocolate|cacao|barra|barras)\b/,
    apiQueries: ["chocolate"],
    descriptionMatches: /chocolate/,
  },

];

// solo acepta descripciones de los productos de caja definidos
// para packaged; excluye equipos y servicios de restaurante
const PACKAGED_DESCRIPTION_MATCHES =
  /(snack|bocadillo|abreboca|gallet|chicle|goma de mascar|confite|caramelo|pastilla|bombon|goma azucarada|chocolate|agua embotellada|agua envasada|agua mineral|bebida gaseosa|bebidas no alcoholicas|refresco|soda)/;

const PACKAGED_DESCRIPTION_EXCLUSIONS =
  /(maquina|maquinaria|aparato|equipo|para envasar|para elaboracion|servicio de restaurante|vendid[oa]s? en restaurantes|superior a 2 kg)/;

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getPackagedSearchRule = (query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  return PACKAGED_SEARCH_RULES.find((rule) =>
    rule.matches.test(normalizedQuery),
  );
};

const isAllowedPackagedDescription = (
  description: string,
  rule?: PackagedSearchRule,
) => {
  const normalizedDescription = normalizeSearchText(description);

  if (PACKAGED_DESCRIPTION_EXCLUSIONS.test(normalizedDescription)) {
    return false;
  }

  if (!PACKAGED_DESCRIPTION_MATCHES.test(normalizedDescription)) {
    return false;
  }

  // Cuando se detecta tipo de producto ,
  // exige que la descripción corresponda a ese tipo
  return !rule || rule.descriptionMatches.test(normalizedDescription);
};
//_______________________________________________


// Búsqueda escrita (empacados)
export const searchFamilyOptions = async (
  fiscalType: FiscalType,
  query: string,
  limit = 10,
): Promise<CabysOption[]> => {
if (!SEARCH_FAMILIES[fiscalType]) return [];

  const term = query.trim();
  if (term.length < 3) return [];

  const rule = getPackagedSearchRule(term);
//si laocnsulta no coincide con un grupo ocnocido , prueba texto original
  const apiQueries = rule?.apiQueries ?? [term];


  const responses = await Promise.all(
    apiQueries.map((apiQuery) =>
      requestCabys(apiQuery, CABYS_MAX_TOP),
    ),
  );


   // Quita duplicados cuando distintos sinonimos encuentran elmismo codigo
  const seenCodes = new Set<string>();
  const uniqueItems = responses.flat().filter((item) => {
    if (seenCodes.has(item.codigo)) return false;
    seenCodes.add(item.codigo);
    return true;
  });

  const relevantItems = uniqueItems.filter((item) =>
    isAllowedPackagedDescription(item.descripcion, rule),
  );

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);

  return toOptions(
    relevantItems,
    [],
    (description) => description.trim(),
    false,
  ).slice(0, safeLimit);
};

// Valida el CABYS elegido contra su familia y devuelve lo que se guarda
export const resolveFiscalOption = async (
  fiscalType: FiscalType | null | undefined,
  rawCabysCode: unknown,
) => {
  if (!fiscalType) {
    return { error: "La categoría no tiene un tipo fiscal asignado" } as const;
  }

  // dishes usa el código por defecto del restaurante 
  if (fiscalType === "dishes") {
    try {
      const items = await requestCabys(DEFAULT_DISH_CABYS_CODE, 1);
//la busqueda debe devolver exactamente el CABYS configurado
      const catalogItem = items.find(
        (item) => item.codigo === DEFAULT_DISH_CABYS_CODE,
      );

      if (!catalogItem) {
        return {
          error: "El CABYS predeterminado de platillos no aparece en el catálogo",
        } as const;
      }
     // Evita aceptar otro resultado que la API devuelva 
      const description = normalizeSearchText(catalogItem.descripcion);
      const isRestaurantWithWaiter =
        /suministro de comida.*servicio de restaurante con mesero/.test(
          description,
        );
 if (!isRestaurantWithWaiter) {
        return {
          error:
            "El CABYS predeterminado ya no corresponde a un restaurante con mesero",
        } as const;
      }

      // toOptions obtiene la tarifa y el código IVA del dato del catalogo
      const [option] = toOptions(
        [catalogItem],
        [],
        cleanLabel,
        false,
      );

      if (!option) {
        return {
          error: "No se pudo determinar la tarifa IVA del CABYS de platillos",
        } as const;
      }

      return {
        option: {
          cabysCode: option.code,
          ivaRate: String(option.ivaRate),
          ivaRateCode: option.ivaRateCode,
        },
      } as const;
    } catch (error) {
      console.error("Error validando el CABYS de platillos:", error);

      return {
        error: "No se pudo consultar el CABYS predeterminado en el catálogo",
      } as const;
    }
  }
  //_________________
  const cabysCode = String(rawCabysCode ?? "").trim();
  if (!/^\d{13}$/.test(cabysCode)) {
    return { error: "Selecciona una opción CABYS válida" } as const;
  }

  const isListFamily = Boolean(FAMILY_CONFIG[fiscalType]);
  const isSearchFamily = SEARCH_FAMILIES[fiscalType] !== undefined;

  if (!isListFamily && !isSearchFamily) {
    return {
      error: "Esta categoría todavía no tiene opciones CABYS disponibles",
    } as const;
  }

  try {
    const options = isListFamily
      ? await fetchFamilyOptions(fiscalType)
      : await searchFamilyOptions(fiscalType, cabysCode, 5);

    const option = options.find((o) => o.code === cabysCode);

    if (!option) {
      return {
        error: "El CABYS seleccionado no corresponde a esta categoría",
      } as const;
    }

    return {
      option: {
        cabysCode: option.code,
        ivaRate: String(option.ivaRate),
        ivaRateCode: option.ivaRateCode,
      },
    } as const;
  } catch (error) {
    console.error("Error verificando CABYS:", error);
    return { error: "No se pudo consultar el catálogo CABYS" } as const;
  }
};