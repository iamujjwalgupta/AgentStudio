import Link from "next/link";

/**
 * Opens the new-agent start screen. The agent itself is created there, once
 * there is a brief to draft from, so a click alone saves nothing.
 */
export default function NewAgentButton() {
  return (
    <Link href="/agents/new" className="btn btn-primary">
      New agent
    </Link>
  );
}
