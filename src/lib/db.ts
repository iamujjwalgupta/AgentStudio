import { Pool } from "pg";

const g = globalThis as unknown as { _asPool?: Pool };

export const pool =
  g._asPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
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
