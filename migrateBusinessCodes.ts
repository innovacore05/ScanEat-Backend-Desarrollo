
import { Pool } from "pg";
import env from "./env";
import {
  hashBusinessCode,
  encryptBusinessCode,
} from "./src/utils/businessCode";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function migrateBusinessCodes() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<{
      business_id: number;
      code: string;
      code_encrypted: string | null;
    }>(`
      SELECT business_id, code, code_encrypted
      FROM businesses
      FOR UPDATE
    `);

    for (const business of result.rows) {
      if (business.code_encrypted !== null) {
        console.log(`Negocio ${business.business_id}: omitido.`);
        continue;
      }

      if (/^[a-f0-9]{64}$/i.test(business.code)) {
        throw new Error(
          `El negocio ${business.business_id} requiere revisión manual.`
        );
      }

      const codeHash = hashBusinessCode(business.code);
      const codeEncrypted = encryptBusinessCode(business.code);

      await client.query(
        `UPDATE businesses
         SET code = $1, code_encrypted = $2
         WHERE business_id = $3`,
        [codeHash, codeEncrypted, business.business_id]
      );

      console.log(`Negocio ${business.business_id}: actualizado.`);
    }

    await client.query("COMMIT");
    console.log("Migración completada.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migración cancelada:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateBusinessCodes();
