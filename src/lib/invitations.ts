import { q, one } from "./db";
import { audit } from "./ai";

/** A pending, unexpired invitation by its link token, if it was sent to this address. */
export async function pendingInvitation(token: string, email: string) {
  return one<any>(
    `select i.*, o.name as org_name from invitations i join orgs o on o.id = i.org_id
      where i.token = $1 and lower(i.email) = lower($2) and i.status = 'pending' and i.expires_at > now()`,
    [token, email],
  );
}

/**
 * Join the invitation's workspace with its role, mark it accepted, and make it
 * the workspace the person is looking at. Used from the in-app banner and when
 * an existing account signs in through an invitation link.
 */
export async function acceptInvitation(inv: any, actor: { id: string; name: string }) {
  await q(
    `insert into memberships (user_id, org_id, role) values ($1,$2,$3)
     on conflict (user_id, org_id) do update set role = excluded.role`,
    [actor.id, inv.org_id, inv.role],
  );
  await q(`update invitations set status='accepted', accepted_at=now(), accepted_by=$2 where id=$1`, [inv.id, actor.id]);
  await q(`update users set active_org_id = $2 where id = $1`, [actor.id, inv.org_id]);
  await audit(inv.org_id, actor, "Joined workspace", "user", actor.id, { role: inv.role, invitedBy: inv.invited_by_name });
}
