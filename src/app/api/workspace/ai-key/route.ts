import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/ai";
import {
  ENGINE_LABEL, setWorkspaceKey, testWorkspaceKey, workspaceKey, workspaceKeyAccess, workspaceKeyFor, workspaceKeyOptions,
  type WorkspaceKey,
} from "@/lib/models";

export const runtime = "nodejs";

const FORBIDDEN = "Only the workspace owner and admins can see or change the workspace AI key.";

/** The option value a key stands for: "env" or its connection id. */
const valueOf = (k: WorkspaceKey | null) => (!k ? "" : k.source === "environment" ? "env" : k.connectionId ?? "");

/** The workspace AI key and the keys it could be. Owner and admins only. */
export async function GET() {
  const u = await requireUser();
  if (!u.canManageMembers) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  const [key, options] = await Promise.all([workspaceKey(u.orgId), workspaceKeyOptions(u.orgId)]);
  const value = valueOf(key);
  return NextResponse.json({
    value,
    // A chosen key that is no longer among the options (removed, env unset) leaves drafting off.
    broken: !!value && !options.some((o) => o.value === value),
    options,
  });
}

/**
 * Chooses the workspace AI key. It is tested first and only saved when it
 * works, so drafting is never pointed at a key that is already failing.
 */
export async function PUT(req: Request) {
  const u = await requireUser();
  if (!u.canManageMembers) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });
  const { value } = await req.json().catch(() => ({}));
  const next = typeof value === "string" ? await workspaceKeyFor(u.orgId, value) : null;
  if (!next) return NextResponse.json({ error: "Choose one of this workspace's model keys." }, { status: 400 });

  let test: { ok: boolean; detail: string };
  try {
    test = await testWorkspaceKey(await workspaceKeyAccess(u.orgId, next));
  } catch (e: any) {
    test = { ok: false, detail: String(e?.message || e) };
  }
  if (!test.ok) return NextResponse.json({ error: `Not saved: the key did not work. ${test.detail}`, test }, { status: 400 });

  const before = await workspaceKey(u.orgId);
  const options = await workspaceKeyOptions(u.orgId);
  const labelOf = (k: WorkspaceKey | null) =>
    !k ? "none" : options.find((o) => o.value === valueOf(k))?.label ?? ENGINE_LABEL[k.provider];
  await setWorkspaceKey(u.orgId, next);
  await audit(u.orgId, u, "Changed workspace AI key", "org", u.orgId, { from: labelOf(before), to: labelOf(next), test: test.detail });
  return NextResponse.json({ ok: true, value: valueOf(next), test });
}
