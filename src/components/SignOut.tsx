"use client";
import { useRouter } from "next/navigation";
import NavIcon from "./NavIcon";

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="sign-out"
      title="Sign out"
      aria-label="Sign out"
      onClick={async () => {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "logout" }),
        });
        router.push("/login");
        router.refresh();
      }}
    >
      <NavIcon name="signout" size={14} />
      <span className="sign-out-label">Sign out</span>
    </button>
  );
}
