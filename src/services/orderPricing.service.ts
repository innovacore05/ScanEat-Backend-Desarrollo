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
) =>
  items.map((item) => {
    const product = productData.get(item.productId)!;
    const ivaRate = product.ivaRate!;

    const gross = roundCurrency(product.price * item.quantity);
    const discountAmount = roundCurrency(gross * (product.discount / 100));
    const subtotal = roundCurrency(gross - discountAmount);
    const taxAmount = roundCurrency(subtotal * (ivaRate / 100));

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: product.price.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      subtotal,
      taxAmount,
      cabysCode: product.cabysCode,
      ivaRate: ivaRate.toFixed(2),
      ivaRateCode: product.ivaRateCode,
      selectedOptions: item.selectedOptions,
      clientId: item.clientId ?? null,
    };
  });