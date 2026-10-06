/**
 * Skill download requests.
 *
 * Only the owner and admins may take a skill out of the workspace as a file.
 * Anyone else asks, with a reason; an admin approves or rejects; an approval
 * allows exactly one download, within DOWNLOAD_WINDOW_DAYS, of the skill as it
 * was at the moment of approval. The snapshot matters: if the skill is edited
 * afterwards, the requester still gets what the admin actually looked at.
 *
 * Every step is audited, and admins are told about new requests over the
 * workspace's own email and Slack connections.
 */
import { q, one } from "./db";
import { audit } from "./ai";
import { notify, adminEmails } from "./notify";
import { formatSkillAsMarkdown } from "./skill-export";

export const DOWNLOAD_WINDOW_DAYS = 7;
export const REASON_MAX = 500;

type Actor = { id: string; name: string; email?: string };

const appUrl = () => (process.env.APP_URL || "").replace(/\/$/, "");

/** Approvals nobody used in time lapse. Applied on read, so no scheduler is needed. */
export async function expireStale(orgId: string): Promise<void> {
  await q(
    `update skill_download_requests set status = 'expired'
      where org_id = $1 and status = 'approved' and expires_at < now()`,
    [orgId],
  );
}

export async function createRequest(
  orgId: string,
  user: Actor,
  skillId: string,
  reason: string,
): Promise<{ ok: true; request: any } | { ok: false; status: number; error: string }> {
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, status: 400, error: "Say why you need the file." };
  if (why.length > REASON_MAX) return { ok: false, status: 400, error: `Keep the reason under ${REASON_MAX} characters.` };

  const skill = await one<any>(`select id, label, status from skills where id = $1 and org_id = $2`, [skillId, orgId]);
  if (!skill) return { ok: false, status: 404, error: "Skill not found." };

  await expireStale(orgId);
  const open = await one<any>(
    `select status from skill_download_requests
      where org_id = $1 and skill_id = $2 and requested_by = $3 and status in ('pending','approved')
      order by created_at desc limit 1`,
    [orgId, skillId, user.id],
  );
  if (open?.status === "pending") return { ok: false, status: 409, error: "You already have a request waiting for this skill." };
  if (open?.status === "approved") return { ok: false, status: 409, error: "Your request is already approved — download it from the Skills page." };

  const request = await one<any>(
    `insert into skill_download_requests (org_id, skill_id, skill_label, requested_by, requested_by_name, reason)
     values ($1, $2, $3, $4, $5, $6)
     returning id, status, created_at`,
    [orgId, skillId, skill.label, user.id, user.name, why],
  );
  await audit(orgId, user, "Requested a skill download", "skill", skillId, { label: skill.label, reason: why, requestId: request.id });

  const link = appUrl() ? `\n\nReview it: ${appUrl()}/approvals` : "";
  await notify(orgId, {
    event: "skill_download_requested",
    subject: `${user.name} asked to download the skill "${skill.label}"`,
    body: `${user.name} would like to download "${skill.label}" as a file.\n\nReason: ${why}${link}`,
    to: await adminEmails(orgId),
    entityId: request.id,
  });
  return { ok: true, request };
}

/** The admin queue: pending requests, or the recent decided ones. */
export async function listRequests(orgId: string, which: "pending" | "decided") {
  await expireStale(orgId);
  return q<any>(
    `select r.id, r.skill_id, r.skill_label, r.requested_by_name, r.reason, r.status, r.created_at,
            r.decided_by_name, r.decided_at, r.decision_note, r.expires_at, r.downloaded_at,
            s.status as skill_status
       from skill_download_requests r
       left join skills s on s.id = r.skill_id
      where r.org_id = $1 and ${which === "pending" ? "r.status = 'pending'" : "r.status <> 'pending'"}
      order by ${which === "pending" ? "r.created_at asc" : "coalesce(r.decided_at, r.created_at) desc"}
      limit 100`,
    [orgId],
  );
}

/** Each skill's latest request by this person, for the Skills page. */
export async function myLatestRequests(orgId: string, userId: string): Promise<Map<string, any>> {
  await expireStale(orgId);
  const rows = await q<any>(
    `select distinct on (skill_id) skill_id, id, status, expires_at, decision_note, decided_by_name
       from skill_download_requests
      where org_id = $1 and requested_by = $2 and skill_id is not null
      order by skill_id, created_at desc`,
    [orgId, userId],
  );
  return new Map(rows.map((r) => [r.skill_id, r]));
}

export async function decideRequest(
  orgId: string,
  admin: Actor,
  requestId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const req = await one<any>(
    `select r.*, us.email as requester_email from skill_download_requests r
       join users us on us.id = r.requested_by
      where r.id = $1 and r.org_id = $2`,
    [requestId, orgId],
  );
  if (!req) return { ok: false, status: 404, error: "Request not found." };
  if (req.status !== "pending") return { ok: false, status: 409, error: "This request has already been decided." };
  if (req.requested_by === admin.id) return { ok: false, status: 403, error: "Someone else has to decide your own request." };

  let snapshot: any = null;
  if (decision === "approved") {
    // What the admin approves is the skill as it stands now; that is what gets downloaded.
    snapshot = await one<any>(
      `select name, label, description, instructions from skills where id = $1 and org_id = $2`,
      [req.skill_id, orgId],
    );
    if (!snapshot) return { ok: false, status: 409, error: "That skill no longer exists, so there is nothing to approve." };
  }

  const updated = await one<any>(
    `update skill_download_requests
        set status = $3, decided_by = $4, decided_by_name = $5, decided_at = now(), decision_note = $6,
            snapshot = $7, expires_at = case when $3 = 'approved' then now() + ($8 || ' days')::interval end
      where id = $1 and org_id = $2 and status = 'pending'
      returning id`,
    [requestId, orgId, decision, admin.id, admin.name, note || null, snapshot ? JSON.stringify(snapshot) : null, String(DOWNLOAD_WINDOW_DAYS)],
  );
  if (!updated) return { ok: false, status: 409, error: "This request has already been decided." };

  await audit(
    orgId,
    admin,
    decision === "approved" ? "Approved a skill download" : "Rejected a skill download",
    "skill",
    req.skill_id,
    { label: req.skill_label, requestedBy: req.requested_by_name, requestId, note },
  );
  const link = appUrl() ? `\n\n${appUrl()}/skills` : "";
  await notify(orgId, {
    event: "skill_download_decided",
    subject:
      decision === "approved"
        ? `Your download of "${req.skill_label}" was approved`
        : `Your download of "${req.skill_label}" was not approved`,
    body:
      decision === "approved"
        ? `${admin.name} approved your request. You can download it once from the Skills page within ${DOWNLOAD_WINDOW_DAYS} days.${note ? `\n\nNote: ${note}` : ""}${link}`
        : `${admin.name} did not approve your request.${note ? `\n\nReason: ${note}` : ""}`,
    to: req.requester_email ? [req.requester_email] : [],
    entityId: requestId,
  });
  return { ok: true };
}

/**
 * The one download an approval allows. The claim is a single conditional update,
 * so two clicks (or two tabs) cannot both get the file.
 */
export async function consumeDownload(
  orgId: string,
  user: Actor,
  requestId: string,
): Promise<{ ok: true; filename: string; markdown: string } | { ok: false; status: number; error: string }> {
  await expireStale(orgId);
  const claimed = await one<any>(
    `update skill_download_requests set status = 'downloaded', downloaded_at = now()
      where id = $1 and org_id = $2 and requested_by = $3 and status = 'approved' and expires_at > now()
      returning skill_id, skill_label, snapshot`,
    [requestId, orgId, user.id],
  );
  if (!claimed) {
    const r = await one<any>(`select status from skill_download_requests where id = $1 and org_id = $2 and requested_by = $3`, [
      requestId,
      orgId,
      user.id,
    ]);
    const why: Record<string, string> = {
      downloaded: "This approval has already been used. Request the download again if you need it.",
      expired: `This approval expired after ${DOWNLOAD_WINDOW_DAYS} days. Request the download again.`,
      pending: "This request is still waiting for an admin.",
      rejected: "This request was not approved.",
    };
    return { ok: false, status: r ? 409 : 404, error: r ? why[r.status] ?? "This download is not available." : "Request not found." };
  }
  await audit(orgId, user, "Downloaded a skill (approved)", "skill", claimed.skill_id, { label: claimed.skill_label, requestId });
  const snap = claimed.snapshot ?? {};
  return { ok: true, filename: `${snap.name || "skill"}.md`, markdown: formatSkillAsMarkdown(snap) };
}
