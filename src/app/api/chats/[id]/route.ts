import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { chatAgent, chatTurns, fileInputKeys, followUpContext } from "@/lib/chat";
import { startAgentRun } from "@/lib/run-start";

export const runtime = "nodejs";

const ownChat = (u: SessionUser, id: string) =>
  one<any>(`select id, agent_id, title, created_at, updated_at from chats where id = $1 and org_id = $2 and user_id = $3`, [
    id,
    u.orgId,
    u.id,
  ]);

/** The conversation, turn by turn. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const chat = await ownChat(u, id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const agent = await chatAgent(u, chat.agent_id);
  if (!agent) return NextResponse.json({ error: "The agent for this conversation no longer exists." }, { status: 404 });
  const turns = await chatTurns(u, id, fileInputKeys(agent.spec));
  return NextResponse.json({ chat, turns });
}

/** A follow-up: a new turn that knows what was said and found before. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const chat = await ownChat(u, id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const agent = await chatAgent(u, chat.agent_id);
  if (!agent) return NextResponse.json({ error: "The agent for this conversation no longer exists." }, { status: 404 });

  const { message, values, dryRun } = await req.json();
  const text = String(message ?? "").trim();
  const supplied: Record<string, string> = values && typeof values === "object" ? values : {};
  const keys = fileInputKeys(agent.spec);
  if (!text && !keys.some((k) => supplied[k])) return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 });

  const turns = await chatTurns(u, id, keys);
  const last = turns[turns.length - 1];
  if (last && !last.stuck && (last.status === "running" || last.status === "awaiting_approval")) {
    return NextResponse.json(
      {
        error:
          last.status === "running"
            ? "The agent is still working on your last message. Wait for it to finish, then ask again."
            : "The last turn is waiting for an approval. Decide it first, then carry on.",
      },
      { status: 409 },
    );
  }

  // What was given before carries forward — the same file, the same period —
  // unless this message brings something new for it.
  const carried: Record<string, string> = { ...(last?.values ?? {}) };
  for (const [k, v] of Object.entries(supplied)) if (String(v ?? "").trim()) carried[k] = v;

  const views = await q<any>(
    `select distinct v.name from file_views v join runs r on r.id = v.run_id where r.chat_id = $1 and r.org_id = $2 order by v.name`,
    [id, u.orgId],
  );
  const context = followUpContext(turns, views.map((v) => v.name));
  const r = await startAgentRun(u, {
    agentId: agent.id,
    input: [context, `The user now asks: ${text || "(no message — see the files given above)"}`].filter(Boolean).join("\n\n"),
    values: carried,
    dryRun: Boolean(dryRun),
    useDraft: !agent.published,
    chatId: id,
    message: text,
    followUp: turns.length > 0,
  });
  if ("error" in r) return NextResponse.json({ error: r.error, ...(r.missing ? { missing: r.missing } : {}) }, { status: r.status });
  await q(`update chats set updated_at = now() where id = $1`, [id]);
  return NextResponse.json({ runId: r.runId }, { status: 202 });
}

/** Removes the conversation. Its runs stay in the run history. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const chat = await ownChat(u, id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await q(`delete from chats where id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
