import "../../../agents/agents.css";
import "../../../approvals/approvals.css";
import "../../../skills/skills.css";
import "@/components/deliverable/deliverable.css";
import "@/components/chat/chat.css";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { chatAgent } from "@/lib/chat";
import { acceptedExtensions, normaliseInputs } from "@/lib/types";
import AgentChat from "@/components/chat/AgentChat";

export const dynamic = "force-dynamic";

export default async function AgentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const u = await requireUser();
  const { id } = await params;
  const { c } = await searchParams;
  const agent = await chatAgent(u, id);
  if (!agent) notFound();

  const inputs = normaliseInputs(agent.spec.inputs as any[]).map((i) => ({ ...i, exts: acceptedExtensions(i) }));
  return (
    <AgentChat
      agent={{
        id: agent.id,
        name: agent.name,
        purpose: agent.spec.purpose || "",
        published: agent.published,
        retired: agent.status === "retired",
      }}
      inputs={inputs}
      initialChatId={c || null}
    />
  );
}
