import { redirect } from "next/navigation";

/** The framework pages became one Sandbox; old links land on it with this framework's examples. */
export default function Page() {
  redirect("/sandbox?framework=adk");
}
