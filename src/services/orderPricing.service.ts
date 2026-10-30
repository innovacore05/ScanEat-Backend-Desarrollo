export const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export type ProductPricingData = {
  price: number;
  discount: number;
  cabysCode: string;
  ivaRate: number | null;
  ivaRateCode: string;
};

export type OrderLineInput = {
  productId: number;
  quantity: number;
  selectedOptions: Record<string, string>;
  clientId?: string | null;
};

export const calculateOrderLines = (
  items: OrderLineInput[],
  productData: Map<number, ProductPricingData>,
  chargesVat: boolean | null,   
) =>
 items.map((item) => {
    const product = productData.get(item.productId)!;

    // false = simplificado: no traslada IVA
    const vat = chargesVat !== false;
    const ivaRate = vat ? product.ivaRate! : 0;
    const ivaRateCode = vat ? product.ivaRateCode : "10";

    const gross = roundCurrency(product.price * item.quantity);
    const discountAmount = roundCurrency(gross * (product.discount / 100));
    const subtotal = roundCurrency(gross - discountAmount);
    const taxAmount = vat ? roundCurrency(subtotal * (ivaRate / 100)) : 0;

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product.price.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      subtotal,
      taxAmount,
      cabysCode: product.cabysCode,
      ivaRate: ivaRate.toFixed(2),
      ivaRateCode,
      selectedOptions: item.selectedOptions,
      clientId: item.clientId ?? null,
    };
  });