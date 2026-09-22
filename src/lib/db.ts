import { Pool } from "pg";

const g = globalThis as unknown as { _asPool?: Pool };

export const pool =
  g._asPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

// Prevent unhandled idle client errors from crashing the Node process
pool.on("error", (err) => {
  console.error("[PostgreSQL Pool Error]", err);
});

if (process.env.NODE_ENV !== "production") g._asPool = pool;

/** Run a query and return all rows. */
export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** Run a query and return the first row, or null. */
export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows.length ? rows[0] : null;
}
