/**
 * Who may delete an agent. Deleting takes every version, run and approval with it.
 *
 * - An admin (the workspace owner counts as one) may delete any agent.
 * - The person who created an agent may delete it while it has never been
 *   published: until then it is their own work in progress.
 * - Once published, it has been live for the workspace, so only an admin may.
 *
 * Shared by the delete endpoint and the pages, so what is offered and what is
 * allowed cannot drift apart. Deleting also always asks for the password.
 */

export type DeleteActor = { id: string; canPublish: boolean };
export type DeleteTarget = { owner_id: string | null; published_ver: number | null };

export function canDeleteAgent(u: DeleteActor, a: DeleteTarget): boolean {
  if (u.canPublish) return true;
  return a.published_ver == null && !!a.owner_id && a.owner_id === u.id;
}

/** Why someone may not delete, in words for the menu and the error. */
export function deleteDeniedReason(u: DeleteActor, a: DeleteTarget): string {
  if (a.published_ver != null) return "Only an admin can delete an agent that has been published. Retire it instead.";
  return "Only the person who created this draft, or an admin, can delete it.";
}
