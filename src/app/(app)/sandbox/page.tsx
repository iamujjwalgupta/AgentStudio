import "../agents/agents.css";
import "./sandbox.css";
import { requireUser } from "@/lib/auth";
import SandboxWorkbench from "@/components/sandbox/SandboxWorkbench";

export const dynamic = "force-dynamic";

const FRAMEWORKS = ["adk", "langchain", "openai", "foundry"];

/** Bring in an agent built with another framework, check it, test it, and add it as a draft. */
export default async function SandboxPage({ searchParams }: { searchParams: Promise<{ framework?: string }> }) {
  await requireUser();
  const { framework } = await searchParams;
  return <SandboxWorkbench initialFramework={framework && FRAMEWORKS.includes(framework) ? framework : ""} />;
}
