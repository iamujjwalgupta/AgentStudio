import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";

/** Everything the current user has been sent, and everything their workspace has sent. */
export async function GET() {
  const u = await requireUser();
  const incoming = await q(
    `select id, agent_name, spec, note, status, from_user_name, from_org_name, created_at, decided_at,
            accepted_agent_id
       from agent_shares where to_user_id = $1 order by created_at desc`,
    [u.id],
  );
  const outgoing = await q(
    `select s.id, s.agent_name, s.note, s.status, s.created_at, s.decided_at,
            us.email as to_email, us.name as to_name, o.name as to_org_name
       from agent_shares s
       join users us on us.id = s.to_user_id
       join orgs o on o.id = s.to_org_id
      where s.from_org_id = $1 order by s.created_at desc`,
    [u.orgId],
  );
  return NextResponse.json({ incoming, outgoing });
}

/** Offers an agent to a user in another workspace. Nothing is copied until they accept. */
export async function POST(req: Request) {
  const u = await requireUser();
  const { agentId, email, note } = await req.json().catch(() => ({}));

  if (!agentId || !email?.trim()) {
    return NextResponse.json({ error: "Choose an agent and enter the person's email address." }, { status: 400 });
  }

  const agent = await one<any>(`select * from agents where id = $1 and org_id = $2`, [agentId, u.orgId]);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const to = await one<any>(
    `select u.id, u.name, u.email, u.org_id, o.name as org_name
       from users u join orgs o on o.id = u.org_id where u.email = $1`,
    [String(email).trim().toLowerCase()],
  );
  if (!to) {
    return NextResponse.json(
      { error: "No one with that email address has an account. They need to sign up first." },
      { status: 404 },
    );
  }
  if (to.id === u.id) return NextResponse.json({ error: "That is your own account." }, { status: 400 });
  if (to.org_id === u.orgId) {
    return NextResponse.json(
      { error: `${to.name} is already in this workspace and can see this agent.` },
      { status: 400 },
    );
  }

  const dupe = await one<any>(
    `select id from agent_shares where agent_id = $1 and to_user_id = $2 and status = 'pending'`,
    [agentId, to.id],
  );
  if (dupe) {
    return NextResponse.json({ error: `${to.name} already has this agent waiting to be accepted.` }, { status: 409 });
  }

  // Send the published version when there is one — that is the reviewed article.
  // Otherwise the draft, which is all that exists.
  let spec: AgentSpec = agent.draft_spec;
  let sourceVersion: number | null = null;
  if (agent.status === "published" && agent.published_ver) {
    const v = await one<any>(`select spec, version from agent_versions where agent_id = $1 and version = $2`, [
      agentId,
      agent.published_ver,
    ]);
    if (v) {
      spec = v.spec;
      sourceVersion = v.version;
    }
  }

  const share = await one<any>(
    `insert into agent_shares
       (agent_id, agent_name, spec, source_version, from_org_id, from_user_id, from_user_name, from_org_name,
        to_user_id, to_org_id, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [
      agentId,
      agent.name,
      JSON.stringify(spec),
      sourceVersion,
      u.orgId,
      u.id,
      u.name,
      u.orgName,
      to.id,
      to.org_id,
      (note || "").slice(0, 500),
    ],
  );

  const detail = { agent: agent.name, to: to.email, toWorkspace: to.org_name, version: sourceVersion };
  await audit(u.orgId, u, "Shared agent", "agent", agentId, detail);
  // Recorded in the recipient's trail too, so an offer is visible from both sides.
  await audit(to.org_id, u, "Received a shared agent", "agent", agentId, {
    agent: agent.name,
    from: u.email,
    fromWorkspace: u.orgName,
  });

  return NextResponse.json({ ok: true, id: share.id, to: { name: to.name, org: to.org_name } });
}
