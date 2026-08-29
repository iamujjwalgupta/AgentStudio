"use client";
import { useRouter } from "next/navigation";

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn sm"
      style={{ marginTop: 8, background: "transparent", color: "#9AA7C0", borderColor: "rgba(255,255,255,.15)" }}
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
      Sign out
    </button>
  );
}
