

export type PaymentMethod = "cash" | "card" | "sinpe";

export type TiqueteLineInput = {
  detail: string;
  quantity: number;
  unitPrice: string | number;
  discount: string | number;
  subtotal: string | number;
  tax: string | number;
  cabysCode: string;
  ivaRate: string | number;
  ivaRateCode: string;

  // Obligatorio si discount es mayor que cero.
  discountCode?: string;
  discountCodeOther?: string;
  discountNature?: string;
};

export type TiqueteReceiverInput = {
  nombre: string;
  tipoIdentificacion?: string;
  numeroIdentificacion?: string;
  correoElectronico?: string;
};

export type TiquetePayloadInput = {
  emisorLegalId: string;
  codigoActividad?: string;
  paymentMethod: PaymentMethod;
  serviceCharge?: string | number;
   chargesVat: boolean;    
  total: string | number;
  lines: TiqueteLineInput[];
  receptor?: TiqueteReceiverInput;
   sustituye?: string;
};

export type TiquetePayload = {
  emisorLegalId: string;
  codigoActividad?: string;
  sustituye?: string;
  condicionVenta: "01";
  currency: "CRC";
  medioPago: Array<{
    tipo: "01" | "02" | "06";
    monto: number;
  }>;
  receptor?: TiqueteReceiverInput;
  detalle: Array<{
    cantidad: number;
    unidadMedida: "Unid";
    codigoCabys: string;
    detalle: string;
    precioUnitario: number;
    descuento?: Array<{
      montoDescuento: number;
      codigoDescuento: string;
      codigoDescuentoOtro?: string;
      naturalezaDescuento?: string;
    }>;
     impuesto: Array<{ codigo: "01"; codigoTarifa: string; tarifa: number }>;
  }>;
    otrosCargos?: Array<{
    tipoDocumento: "06"; 
    detalle: string;
    porcentaje: number;
    montoCargo: number;
  }>;
};

const IVA_RATE_BY_CODE: Record<string, number> = {
  "01": 0,
  "02": 1,
  "03": 2,
  "04": 4,
  "08": 13,
  "09": 0.5,
  "10": 0,
  "11": 0,
};

const PAYMENT_CODE: Record<PaymentMethod, "01" | "02" | "06"> = {
  cash: "01",
  card: "02",
  sinpe: "06",
};

const toNonNegativeNumber = (
  value: string | number,
  field: string,
): number => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${field} debe ser un número mayor o igual a cero.`);
  }

  return number;
};

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const sameCurrency = (a: number, b: number): boolean =>
  Math.round(a * 100) === Math.round(b * 100);

export class TiquetePayloadBuilder {
  static build(input: TiquetePayloadInput): TiquetePayload {
    const emisorLegalId = input.emisorLegalId.trim();

    //esto es para manejar tiquetes rechazados 
const substituteKey = input.sustituye?.trim();

if (input.sustituye !== undefined && !/^\d{50}$/.test(substituteKey ?? "")) {
  throw new Error("La clave del tiquete rechazado no es válida.");
}

 const vat = input.chargesVat !== false;
    const serviceCharge = toNonNegativeNumber(
      input.serviceCharge ?? 0,
      "Cargo de servicio",
    );

    let calculatedTotal = 0;
    let netTotal = 0;


    if (!emisorLegalId) {
      throw new Error("Falta el identificador fiscal del emisor.");
    }

    if (!input.lines.length) {
      throw new Error("El tiquete debe incluir al menos una línea.");
    }

    if (input.receptor) {
      const hasIdType = Boolean(input.receptor.tipoIdentificacion);
      const hasIdNumber = Boolean(input.receptor.numeroIdentificacion);

      if (hasIdType !== hasIdNumber) {
        throw new Error(
          "El receptor debe incluir tipo y número de identificación, o ninguno.",
        );
      }

      if (input.receptor.nombre.trim().length < 3) {
        throw new Error("El nombre del receptor debe tener al menos 3 caracteres.");
      }
    }

    

    const detalle = input.lines.map((line, index) => {
      const lineNumber = index + 1;
      const quantity = Number(line.quantity);
      const unitPrice = toNonNegativeNumber(
        line.unitPrice,
        `Precio unitario de la línea ${lineNumber}`,
      );
      const discount = toNonNegativeNumber(
        line.discount,
        `Descuento de la línea ${lineNumber}`,
      );
      const subtotal = toNonNegativeNumber(
        line.subtotal,
        `Subtotal de la línea ${lineNumber}`,
      );
      const tax = toNonNegativeNumber(
        line.tax,
        `Impuesto de la línea ${lineNumber}`,
      );
    const tariffCode = vat ? line.ivaRateCode : "10";

const rate = vat
  ? toNonNegativeNumber(
      line.ivaRate,
      `Tarifa IVA de la línea ${lineNumber}`,
    )
  : 0;

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`La cantidad de la línea ${lineNumber} no es válida.`);
      }

      if (!/^\d{13}$/.test(line.cabysCode)) {
        throw new Error(`El CABYS de la línea ${lineNumber} no es válido.`);
      }

      const expectedRate = IVA_RATE_BY_CODE[tariffCode];

      if (expectedRate === undefined || !sameCurrency(rate, expectedRate)) {
        throw new Error(
          `El código de tarifa IVA de la línea ${lineNumber} no coincide con su tarifa.`,
        );
      }

      const gross = roundCurrency(unitPrice * quantity);
      const expectedSubtotal = roundCurrency(gross - discount);
      const expectedTax = roundCurrency(expectedSubtotal * (rate / 100));

      if (discount > gross || !sameCurrency(subtotal, expectedSubtotal)) {
        throw new Error(
          `El subtotal de la línea ${lineNumber} no coincide con precio, cantidad y descuento.`,
        );
      }

      if (!sameCurrency(tax, expectedTax)) {
        throw new Error(
          `El impuesto de la línea ${lineNumber} no coincide con su tarifa.`,
        );
      }

      let descuento: TiquetePayload["detalle"][number]["descuento"];

      if (discount > 0) {
        const discountCode = line.discountCode?.trim();

        if (!discountCode) {
          throw new Error(
            `Falta clasificar el descuento de la línea ${lineNumber}.`,
          );
        }

        if (discountCode === "99") {
          if (!line.discountCodeOther?.trim() || !line.discountNature?.trim()) {
            throw new Error(
              `El descuento "Otros" de la línea ${lineNumber} requiere descripción y naturaleza.`,
            );
          }
        }

        if (
          (discountCode === "01" || discountCode === "03") &&
          !sameCurrency(discount, gross)
        ) {
          throw new Error(
            `El descuento ${discountCode} de la línea ${lineNumber} debe cubrir el 100 % de la línea.`,
          );
        }

        descuento = [
          {
            montoDescuento: discount,
            codigoDescuento: discountCode,
            ...(discountCode === "99"
              ? {
                  codigoDescuentoOtro: line.discountCodeOther!.trim(),
                  naturalezaDescuento: line.discountNature!.trim(),
                }
              : {}),
          },
        ];
      }

        calculatedTotal += expectedSubtotal + expectedTax;
      netTotal += expectedSubtotal;

       return {
        cantidad: quantity,
        unidadMedida: "Unid" as const,
        codigoCabys: line.cabysCode,
        detalle: line.detail.trim(),
        precioUnitario: unitPrice,
        ...(descuento ? { descuento } : {}),
        impuesto: [
          {
            codigo: "01" as const,
            codigoTarifa: tariffCode,
            tarifa: rate,
          },
        ],
      };
    });

        if (
      serviceCharge > 0 &&
      Math.abs(serviceCharge - netTotal * 0.1) > 0.01
    ) {
      throw new Error("El cargo de servicio no coincide con el 10 % de la venta neta.");
    }

    const total = toNonNegativeNumber(input.total, "Total del tiquete");

    if (!sameCurrency(total, roundCurrency(calculatedTotal + serviceCharge))) {
      throw new Error("El total del tiquete no coincide con sus líneas.");
    }

    return {
      emisorLegalId,
      ...(substituteKey ? { sustituye: substituteKey } : {}),
      ...(input.codigoActividad?.trim()
        ? { codigoActividad: input.codigoActividad.trim() }
        : {}),
      condicionVenta: "01",
      currency: "CRC",
      medioPago: [{ tipo: PAYMENT_CODE[input.paymentMethod], monto: total }],
      ...(input.receptor ? { receptor: input.receptor } : {}),
      detalle,
      ...(serviceCharge > 0
        ? {
            otrosCargos: [
              {
                tipoDocumento: "06" as const,
                detalle: "Impuesto de servicio 10%",
                porcentaje: 10,
                montoCargo: serviceCharge,
              },
            ],
          }
        : {}),
    };
     }
}