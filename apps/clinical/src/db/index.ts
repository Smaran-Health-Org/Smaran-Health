import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Admin-only connection — for seed scripts and migrations.
// App code must use supabase-js (via @supabase/ssr) to get RLS enforcement.

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString: url });
}

let pool: Pool;

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

export function getAdminDb() {
  return drizzle(getPool(), { schema });
}

export { schema };
