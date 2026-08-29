// Applies db/schema.sql to the database in DATABASE_URL. Safe to re-run.
import fs from "fs";
import path from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const sql = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`
  );
  console.log("Schema applied. Tables:", rows.map((r) => r.table_name).join(", "));
  console.log("\nNext: npm run dev, then open http://localhost:3000 and create your workspace.");
} catch (e) {
  console.error("Setup failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
