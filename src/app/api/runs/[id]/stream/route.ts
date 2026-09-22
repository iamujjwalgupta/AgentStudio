import { NextRequest } from "next/server";
import { q, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { id } = await params;
  const initialRun = await one<any>(
    `select r.id, r.org_id, r.status, r.output, r.error, r.agent_id, a.name as agent_name
       from runs r join agents a on a.id = r.agent_id
      where r.id = $1 and r.org_id = $2`,
    [id, user.orgId]
  );

  if (!initialRun) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  let closed = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let lastIdx = -1;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = (event: string, data: any) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 1. Send initial snapshot
      try {
        const steps = await q<any>(`select * from run_steps where run_id = $1 order by idx asc`, [id]);
        if (steps.length > 0) {
          lastIdx = steps[steps.length - 1].idx;
        }
        const approvals = await q<any>(
          `select a.*, us.name as decided_by_name from approvals a left join users us on us.id = a.decided_by
            where a.run_id = $1 order by a.created_at asc`,
          [id]
        );

        sendEvent("init", { run: initialRun, steps, approvals });

        if (["completed", "failed", "rejected"].includes(initialRun.status)) {
          sendEvent("done", { status: initialRun.status, output: initialRun.output, error: initialRun.error });
          controller.close();
          return;
        }

        // 2. Poll for increments every 1s while running
        pollTimer = setInterval(async () => {
          if (closed) return;
          try {
            const currentRun = await one<any>(`select status, output, error from runs where id = $1`, [id]);
            if (!currentRun) {
              if (pollTimer) clearInterval(pollTimer);
              controller.close();
              return;
            }

            // New steps
            const newSteps = await q<any>(
              `select * from run_steps where run_id = $1 and idx > $2 order by idx asc`,
              [id, lastIdx]
            );
            for (const s of newSteps) {
              lastIdx = Math.max(lastIdx, s.idx);
              sendEvent("step", s);
            }

            // Updated approvals
            const pendingApprovals = await q<any>(
              `select a.*, us.name as decided_by_name from approvals a left join users us on us.id = a.decided_by
                where a.run_id = $1 order by a.created_at asc`,
              [id]
            );
            sendEvent("approvals", pendingApprovals);

            // Completion check
            if (["completed", "failed", "rejected"].includes(currentRun.status)) {
              sendEvent("done", { status: currentRun.status, output: currentRun.output, error: currentRun.error });
              if (pollTimer) clearInterval(pollTimer);
              controller.close();
              closed = true;
            }
          } catch (e: any) {
            console.error("[SSE Polling Error]", e);
          }
        }, 1000);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
