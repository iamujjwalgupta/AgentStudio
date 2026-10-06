import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { chatAgent, chatTitle, fileInputKeys } from "@/lib/chat";
import { startAgentRun } from "@/lib/run-start";

export const runtime = "nodejs";

/** This person's conversations with one agent, newest first. */
export async function GET(req: Request) {
  const u = await requireUser();
  const agentId = new URL(req.url).searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "Which agent?" }, { status: 400 });
  const chats = await q<any>(
    `select c.id, c.title, c.updated_at,
            (select r.status from runs r where r.chat_id = c.id order by r.started_at desc limit 1) as last_status,
            (select count(*)::int from runs r where r.chat_id = c.id) as turns
       from chats c
      where c.org_id = $1 and c.user_id = $2 and c.agent_id = $3
      order by c.updated_at desc
      limit 50`,
    [u.orgId, u.id, agentId],
  );
  return NextResponse.json({ chats });
}

/** Starts a conversation: the chat, and its first turn. */
export async function POST(req: Request) {
  const u = await requireUser();
  const { agentId, message, values, dryRun } = await req.json();
  const agent = agentId ? await chatAgent(u, agentId) : null;
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const text = String(message ?? "").trim();
  const supplied: Record<string, string> = values && typeof values === "object" ? values : {};
  const files = fileInputKeys(agent.spec).map((k) => supplied[k]).filter(Boolean);

  const chat = await one<any>(
    `insert into chats (org_id, agent_id, user_id, title) values ($1,$2,$3,$4) returning id`,
    [u.orgId, agent.id, u.id, chatTitle(text, files)],
  );
  const r = await startAgentRun(u, {
    agentId: agent.id,
    input: text,
    values: supplied,
    dryRun: Boolean(dryRun),
    useDraft: !agent.published,
    chatId: chat.id,
    message: text,
  });
  if ("error" in r) {
    // Nothing was started, so there is no conversation to keep.
    await q(`delete from chats where id = $1`, [chat.id]);
    return NextResponse.json({ error: r.error, ...(r.missing ? { missing: r.missing } : {}) }, { status: r.status });
  }
  return NextResponse.json({ chatId: chat.id, runId: r.runId }, { status: 202 });
}
