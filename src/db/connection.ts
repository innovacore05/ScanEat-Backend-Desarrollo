import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as userSchema from "./schemas/userSchema";
import * as mesaSchema from "./schemas/mesaSchema";
import * as orderSchema from "./schemas/orderSchema";
import * as reviewSchema from "./schemas/reviewSchema";
import * as restaurantThemeSchema from "./schemas/restaurantThemeSchema";
import env from "../../env";
import * as sharedCartSchema from "./schemas/sharedCartSchema";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  max: 5,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("error", (error) => {
  console.error(
    "Error en una conexión inactiva de PostgreSQL:",
    error.message,
  );
});

export const db = drizzle(pool, {
  schema: {
    ...userSchema,
    ...mesaSchema,
    ...orderSchema,
    ...reviewSchema,
    ...restaurantThemeSchema,
    ...sharedCartSchema,
  },
});

export default db;