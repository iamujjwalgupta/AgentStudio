import { redirect } from "next/navigation";

/** Spend became Usage & limits; old links and bookmarks land there. */
export default function SpendPage() {
  redirect("/usage");
}
