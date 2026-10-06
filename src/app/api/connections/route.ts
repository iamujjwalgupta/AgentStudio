import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/ai";
import { SINGLE_KINDS, USABLE_KINDS, kindLabel, missingFor } from "@/lib/connection-types";

export const runtime = "nodejs";

/**
 * The workspace's connections, each with the agents it is attached to, so nobody
 * removes one without seeing who depends on it. secret_enc is never selected.
 */
export async function GET() {
  const u = await requireUser();
  const rows = await q(
    `select c.id, c.name, c.kind, c.config - 'health' as config, c.created_at, (c.secret_enc is not null) as has_secret,
            (select us.name from users us where us.id = c.created_by) as created_by_name,
            coalesce((
              select json_agg(json_build_object('id', a.id, 'name', a.name, 'status', a.status) order by a.name)
                from agents a
               where a.org_id = c.org_id
                 and a.draft_spec->'sources' @> jsonb_build_array(jsonb_build_object('connectionId', c.id::text))
            ), '[]'::json) as used_by
       from connections c
      where c.org_id = $1
      order by c.created_at desc`,
    [u.orgId],
  );
  return NextResponse.json({ connections: rows });
}

export async function POST(req: Request) {
  const u = await requireUser();
  const { name, kind, config, secret } = await req.json().catch(() => ({}));
  if (!name?.trim() || !kind) return NextResponse.json({ error: "Give the connection a name and a type." }, { status: 400 });

  // Only kinds some agent action, or the platform, can use (lib/connection-types).
  if (!USABLE_KINDS.has(kind)) {
    return NextResponse.json({ error: `“${kind}” is not a kind of connection agents can use.` }, { status: 400 });
  }
  const missing = missingFor(kind, config || {}, !!secret?.trim());
  if (missing) return NextResponse.json({ error: missing }, { status: 400 });

  if (SINGLE_KINDS.has(kind)) {
    const existing = await one<any>(`select name from connections where org_id = $1 and kind = $2`, [u.orgId, kind]);
    if (existing) {
      return NextResponse.json(
        { error: `This workspace already has a ${kindLabel(kind)} key (“${existing.name}”). Edit that one instead.` },
        { status: 409 },
      );
    }
  }

  const row = await one<any>(
    `insert into connections (org_id, name, kind, config, secret_enc, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, name, kind, config, created_at`,
    [u.orgId, name.trim(), kind, JSON.stringify(config || {}), secret?.trim() ? encrypt(secret.trim()) : null, u.id],
  );
  await audit(u.orgId, u, "Added connection", "connection", row.id, { name: name.trim(), kind });
  return NextResponse.json({ connection: row });
}
