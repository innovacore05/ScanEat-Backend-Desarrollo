import { Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { invoicingConfig, issuerSchema } from "../db/schemas/billingSchema";
import { AuthRequest } from "../middleware/authenticate";
import { fetchRegime } from "../services/factura.service";

// obtener los datos del emisor del negocio
export const getIssuer = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      return res
        .status(400)
        .json({ message: "El usuario no tiene un negocio asociado" });
    }

    const [row] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    res.json(row ?? null);
  } catch (error) {
    console.error("Error obteniendo datos del emisor:", error);
    res
      .status(500)
      .json({ message: "No se pudo cargar la información del emisor" });
  }
};

// guardar (crear o actualizar) los datos del emisor
export const saveIssuer = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      return res
        .status(400)
        .json({ message: "El usuario no tiene un negocio asociado" });
    }

    const parsed = issuerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const values = {
      ...parsed.data,
      neighborhood: parsed.data.neighborhood || null,
    };

    const [current] = await db
      .select({
        environment: invoicingConfig.environment,
        legalId: invoicingConfig.legalId,
        legalIdType: invoicingConfig.legalIdType,
      })
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    const identityChanged =
      !!current &&
      (current.legalId !== values.legalId ||
        current.legalIdType !== values.legalIdType);

    const certificateInvalidated =
      !!current && (identityChanged || current.environment !== values.environment);

    // el régimen lo decide el backend, nunca el cliente
    let regime: Awaited<ReturnType<typeof fetchRegime>> = null;
    try {
      regime = await fetchRegime(values.legalId);
    } catch (error) {
      console.error("No se pudo verificar el régimen:", error);
    }

    const regimeFields = regime
      ? {
          regimeKey: regime.key,
          chargesVat: regime.chargesVat,
          regimeVerifiedAt: new Date(),
        }
      : identityChanged
        ? { regimeKey: null, chargesVat: null, regimeVerifiedAt: null }
        : {}; // misma cédula y falló la consulta: se conserva lo guardado

    await db
      .insert(invoicingConfig)
      .values({ businessId, ...values, ...regimeFields })
      .onConflictDoUpdate({
        target: invoicingConfig.businessId,
        set: {
          ...values,
          ...regimeFields,
          ...(certificateInvalidated ? { certificateUploadedAt: null } : {}),
          updatedAt: new Date(),
        },
      });
    res.json({
      ok: true,
      regimeVerified: regime !== null,
      certificateInvalidated,
    });
  } catch (error) {
    console.error("Error guardando datos del emisor:", error);
    res
      .status(500)
      .json({ message: "No se pudo guardar la información del emisor" });
  }
};



// reenvio de el .p12 y las credenciales a Factura en CR. No se guarda nada de esto
export const uploadCertificate = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      return res
        .status(400)
        .json({ message: "El usuario no tiene un negocio asociado" });
    }

    const { p12Password, haciendaUsername, haciendaPassword } = req.body;

    if (!req.file || !p12Password || !haciendaUsername || !haciendaPassword) {
      return res.status(400).json({
        message: "Faltan el .p12, su PIN o las credenciales de Hacienda",
      });
    }

    if (!req.file.originalname.toLowerCase().endsWith(".p12")) {
      return res.status(400).json({ message: "El archivo debe ser un .p12" });
    }

    // los datos del emisor salen de lo que ya esta guardado
    const [row] = await db
      .select()
      .from(invoicingConfig)
      .where(eq(invoicingConfig.businessId, businessId))
      .limit(1);

    if (!row) {
      return res
        .status(400)
        .json({ message: "Guardá primero los datos del emisor" });
    }

    const emisor = {
      tipoIdentificacion: row.legalIdType,
      numeroIdentificacion: row.legalId,
      nombre: row.legalName,
      codigoActividad: [row.activityCode],
      correoElectronico: row.email,
      telefono: { codigoPais: "506", numTelefono: row.phone },
      ubicacion: {
        provincia: row.province,
        canton: row.canton,
        distrito: row.district,
        ...(row.neighborhood ? { barrio: row.neighborhood } : {}),
        otrasSenas: row.address,
      },
    };

    const body = new FormData();
    body.append("p12", new Blob([new Uint8Array(req.file.buffer)]), "certificado.p12");
    body.append("p12Password", p12Password);
    body.append("haciendaUsername", haciendaUsername);
    body.append("haciendaPassword", haciendaPassword);
    body.append("alias", `${row.legalName} (${row.environment})`);
    body.append("environment", row.environment);
    body.append("emisor", JSON.stringify(emisor));

    const response = await fetch("https://api.facturaencr.com/v2/efactura/certificates", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.FACTURAENCR_API_KEY!,
    "X-API-Secret": process.env.FACTURAENCR_API_SECRET!,
  },
  body,
});

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      return res.status(response.status >= 500 ? 502 : 400).json({
        message: error?.message ?? "Factura en CR rechazó el certificado",
      });
    }

    await db
      .update(invoicingConfig)
      .set({ certificateUploadedAt: new Date() })
      .where(eq(invoicingConfig.businessId, businessId));

    res.json({ ok: true });
  } catch (error) {
    console.error("Error subiendo el certificado:", error);
    res.status(500).json({ message: "No se pudo subir el certificado" });
  }
};


//lookupTaxpayer para consultar al contribuyente en hacienda
const LEGAL_ID_REGEX = /^[0-9A-Za-z]{9,12}$/;

// Hacienda asigna esta actividad por defecto a una sociedad sin actividad comercial
const GENERIC_ACTIVITY = /legalmente constituid/i;

type TaxpayerResponse = {
  encontrado?: boolean;
  contribuyente?: boolean | null;
  nombre?: string;
  nombreComercial?: string;
  tipoIdentificacion?: string;
  puedeEmitir?: boolean;
  regimen?: { clave?: string; simplificado?: boolean; trasladaIva?: boolean };
  actividades?: Array<{
    codigo?: string;
    descripcion?: string;
    estado?: string;
    tipo?: string;
  }>;
};

// consulta de la cedula contra el registro de Hacienda (via Factura en CR)
export const lookupTaxpayer = async (req: AuthRequest, res: Response) => {
  try {
    const legalId = String(req.params.legalId ?? "").trim();
    if (!LEGAL_ID_REGEX.test(legalId)) {
      return res.status(400).json({
        message: "La cédula debe tener entre 9 y 12 caracteres, sin guiones",
      });
    }

    const response = await fetch(
      `https://api.facturaencr.com/v2/efactura/contribuyentes/${encodeURIComponent(legalId)}`,
      {
        headers: {
          "X-API-Key": process.env.FACTURAENCR_API_KEY!,
          "X-API-Secret": process.env.FACTURAENCR_API_SECRET!,
          Accept: "application/json",
        },
      },
    );

    if (response.status === 503) {
      return res.status(503).json({
        message: "Hacienda no respondió. Podés completar los datos a mano.",
      });
    }
    if (!response.ok) {
      return res.status(response.status >= 500 ? 502 : 400).json({
        message: "No se pudo consultar la cédula",
      });
    }

    const data = (await response.json()) as TaxpayerResponse;

    if (data.encontrado === false) {
      return res
        .status(404)
        .json({ message: "No se encontró esa cédula en Hacienda" });
    }

    const activities = (data.actividades ?? [])
      .filter((a) => a.codigo && (!a.estado || a.estado === "A"))
      // la principal (tipo "P") primero
      .sort((a, b) => (a.tipo === "P" ? -1 : 0) - (b.tipo === "P" ? -1 : 0))
      .map((a) => ({
        code: String(a.codigo).trim(),
        description: String(a.descripcion ?? "").trim(),
      }))
      .filter((a) => !GENERIC_ACTIVITY.test(a.description));

    // por si Hacienda no manda el tipo: 9 = física, 10 = jurídica, 11-12 = DIMEX
    const fallbackType =
      legalId.length === 9 ? "01" : legalId.length === 10 ? "02" : "03";

    res.json({
      legalName: data.nombre?.trim() || null,
      tradeName: data.nombreComercial?.trim() || null,
      registered: data.contribuyente ?? null,
      legalIdType: data.tipoIdentificacion ?? fallbackType,
      canIssue: data.puedeEmitir ?? null,
      chargesVat: data.regimen?.trasladaIva ?? null,
      hasCommercialActivity: activities.length > 0,
      activities,
    });
  } catch (error) {
    console.error("Error consultando contribuyente:", error);
    res.status(500).json({ message: "No se pudo consultar la cédula" });
  }
};