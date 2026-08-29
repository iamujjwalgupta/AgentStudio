import { one } from "./db";
import type { SessionUser } from "./auth";

/**
 * Who may decide a held action.
 *
 * Approving is a separate duty from building: admins and builders make agents,
 * approvers review what those agents want to do. The owner always retains the
 * ability so a workspace can never lock itself out of its own runs.
 */
export function canDecide(u: SessionUser): boolean {
  return u.isOwner || u.role === "approver";
}

export const CANNOT_DECIDE =
  "Only the workspace owner and people with the approver role can decide a held action.";

/** How many people *other than this one* could decide in this workspace. */
export async function otherApproverCount(orgId: string, exceptUserId: string): Promise<number> {
  const row = await one<any>(
    `select count(*)::int as n
       from memberships m
       join orgs o on o.id = m.org_id
      where m.org_id = $1
        and (m.role = 'approver' or o.owner_id = m.user_id)
        and m.user_id <> $2`,
    [orgId, exceptUserId],
  );
  return row?.n ?? 0;
}

/**
 * Whether this person may decide this particular approval.
 *
 * Segregation of duties: the person who started a run does not decide what that
 * run wants to do — unless nobody else can, in which case the decision is
 * allowed and stamped as self-approved rather than deadlocking the workspace.
 */
export async function decisionCheck(
  u: SessionUser,
  startedBy: string | null,
): Promise<{ allowed: boolean; selfApproved: boolean; reason?: string }> {
  if (!canDecide(u)) return { allowed: false, selfApproved: false, reason: CANNOT_DECIDE };
  if (startedBy !== u.id) return { allowed: true, selfApproved: false };

  const others = await otherApproverCount(u.orgId, u.id);
  if (others > 0) {
    return {
      allowed: false,
      selfApproved: false,
      reason:
        "You started this run, so someone else must decide what it does. " +
        `There ${others === 1 ? "is 1 other person" : `are ${others} other people`} in this workspace who can.`,
    };
  }
  return { allowed: true, selfApproved: true };
}
