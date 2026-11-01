import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { invoicingConfig } from "../db/schemas/billingSchema";


type Executor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

// true = traslada IVA, false = simplificado, null = nunca verificado
export const getChargesVat = async (
  businessId: number,
   executor: Executor = db,
): Promise<boolean | null> => {
  const [row] = await executor
    .select({ chargesVat: invoicingConfig.chargesVat })
    .from(invoicingConfig)
    .where(eq(invoicingConfig.businessId, businessId))
    .limit(1);

  return row?.chargesVat ?? null;
};