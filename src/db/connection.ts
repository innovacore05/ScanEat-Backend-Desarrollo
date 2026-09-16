import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as userSchema from "./schemas/userSchema";
import * as mesaSchema from "./schemas/mesaSchema";
import * as orderSchema from "./schemas/orderSchema";
import * as reviewSchema from "./schemas/reviewSchema";
import env from "../../env";

const createPool = () => {
  return new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    max: 1,
    ssl: {
      rejectUnauthorized: false,
    },
  });
};

export const db = drizzle(createPool(), {
  schema: {
    ...userSchema,
    ...mesaSchema,
    ...orderSchema,
    ...reviewSchema,
  },
});

export default db;
