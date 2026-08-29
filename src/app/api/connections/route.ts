import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET() {
  const u = await requireUser();
  // secret_enc is deliberately never selected.
  const rows = await q(
    `select id, name, kind, config, created_at from connections where org_id = $1 order by created_at desc`,
    [u.orgId],
  );
  return NextResponse.json({ connections: rows });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const { name, kind, config, secret } = await req.json();
  if (!name || !kind) return NextResponse.json({ error: "Give the connection a name and a type." }, { status: 400 });
  const row = await one<any>(
    `insert into connections (org_id, name, kind, config, secret_enc, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, name, kind, config, created_at`,
    [u.orgId, name, kind, JSON.stringify(config || {}), secret ? encrypt(secret) : null, u.id],
  );
  await audit(u.orgId, u, "Added connection", "connection", row.id, { name, kind });
  return NextResponse.json({ connection: row });
}
