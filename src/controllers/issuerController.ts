import { Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { invoicingConfig, issuerSchema } from "../db/schemas/billingSchema";
import { AuthRequest } from "../middleware/authenticate";

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

    await db
      .insert(invoicingConfig)
      .values({ businessId, ...values })
      .onConflictDoUpdate({
        target: invoicingConfig.businessId,
        set: { ...values, updatedAt: new Date() },
      });

    res.json({ ok: true });
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