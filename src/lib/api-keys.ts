import crypto from "crypto";
import { one, q } from "./db";
import { getUser } from "./auth";

/**
 * Workspace API keys: how another application calls an agent with nobody
 * signed in. A key is `as_live_` plus 32 random characters. Only its SHA-256 is
 * stored, so a key can be shown once and never recovered; the first characters
 * are kept in the clear so people can tell their keys apart.
 */

const PREFIX = "as_live_";

export type ApiKey = {
  id: string;
  org_id: string;
  name: string;
  prefix: string;
  agent_ids: string[] | null;
  created_by: string | null;
  created_by_name: string;
};

export const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export function generateKey() {
  const key = PREFIX + crypto.randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, PREFIX.length + 4), hash: hashKey(key) };
}

/** The key sent as `Authorization: Bearer as_live_…` (or `X-API-Key`), if any. */
function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  const raw = bearer || req.headers.get("x-api-key")?.trim() || "";
  return raw || null;
}

/**
 * Who is calling: an API key, or a person signed in to the app. A request that
 * carries a key is judged by the key alone, never by a cookie riding along.
 */
export type Caller =
  | { kind: "key"; orgId: string; user: { id: string; name: string }; key: ApiKey }
  | { kind: "session"; orgId: string; user: { id: string; name: string } };

export async function resolveCaller(req: Request): Promise<Caller | { error: string }> {
  const raw = presentedKey(req);
  if (raw) {
    if (!raw.startsWith(PREFIX)) return { error: "That is not an Agent Studio API key. Keys start with as_live_." };
    const key = await one<ApiKey>(
      `select id, org_id, name, prefix, agent_ids, created_by, created_by_name
         from api_keys where key_hash = $1 and revoked_at is null`,
      [hashKey(raw)],
    );
    if (!key) return { error: "That API key is not valid, or has been revoked." };
    if (!key.created_by) return { error: "The account that created this API key no longer exists. Ask an admin for a new key." };
    // Recorded at most once a minute, so a busy integration doesn't write on every call.
    q(
      `update api_keys set last_used_at = now()
        where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
      [key.id],
    ).catch(() => {});
    // Runs are started on behalf of the person who created the key, and say which key.
    return { kind: "key", orgId: key.org_id, user: { id: key.created_by, name: `API key “${key.name}”` }, key };
  }
  const u = await getUser();
  if (!u) return { error: "Send an API key in the Authorization header (Bearer as_live_…). Admins create keys under Workspace → API keys." };
  return { kind: "session", orgId: u.orgId, user: { id: u.id, name: u.name } };
}

export const keyCoversAgent = (key: ApiKey, agentId: string) => !key.agent_ids || key.agent_ids.includes(agentId);
