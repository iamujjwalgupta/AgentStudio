import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await getUser();
  redirect(u ? "/agents" : "/login");
}
