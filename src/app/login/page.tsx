import "./login.css";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import LoginScreen from "@/components/login/LoginScreen";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Agent Studio" };

/** Signed-in people go straight to their agents, unless they followed an invitation link. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  if (!invite && (await getUser())) redirect("/agents");
  return <LoginScreen />;
}
