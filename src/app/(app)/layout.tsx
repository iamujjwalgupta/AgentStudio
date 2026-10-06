import "./rail.css";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import SignOut from "@/components/SignOut";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import InviteBanner from "@/components/InviteBanner";
import GuidedDemo, { TourLauncher } from "@/components/GuidedDemo";
import RailToggle from "@/components/RailToggle";
import SidebarNav from "@/components/SidebarNav";

export const dynamic = "force-dynamic";

const initials = (n: string) =>
  n.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  let pending = 0;
  let shares = 0;
  let running = 0;
  try {
    const [ap, sh, rn] = await Promise.all([
      q<any>(`select count(*)::int as n from approvals where org_id = $1 and status = 'pending'`, [user.orgId]),
      q<any>(`select count(*)::int as n from agent_shares where to_user_id = $1 and status = 'pending'`, [user.id]),
      // Runs still working; one "running" for longer than half an hour has stopped (see lib/run-list).
      q<any>(`select count(*)::int as n from runs where org_id = $1 and status = 'running' and started_at >= now() - interval '30 minutes'`, [user.orgId]),
    ]);
    pending = ap[0]?.n ?? 0;
    shares = sh[0]?.n ?? 0;
    running = rn[0]?.n ?? 0;
    // Skill download requests wait on the owner and admins, on the same Approvals page.
    if (user.canPublish) {
      const dl = await q<any>(`select count(*)::int as n from skill_download_requests where org_id = $1 and status = 'pending'`, [user.orgId]);
      pending += dl[0]?.n ?? 0;
    }
  } catch {
    /* database not reachable yet — the pages will surface it */
  }

  // The rail's collapsed state lives in a cookie so it is rendered correctly on first paint.
  const collapsed = cookies().get("as_rail")?.value === "collapsed";
  const role = user.isOwner ? "Owner" : user.role ? user.role[0].toUpperCase() + user.role.slice(1) : "Member";

  return (
    <div className={`shell${collapsed ? " rail-collapsed" : ""}`}>
      <aside className="rail">
        <div className="brand rl-brand" data-tour="brand">
          <div className="rail-top">
            <Link href="/agents" className="rl-home" aria-label="Agent Studio — home">
              <span className="rl-logo" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                  <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
                </svg>
              </span>
              <span className="brand-name">Agent Studio</span>
            </Link>
            <RailToggle initialCollapsed={collapsed} />
          </div>
          <WorkspaceSwitcher memberships={user.memberships} activeOrgId={user.orgId} />
        </div>

        <SidebarNav approvals={pending} shares={shares} running={running} showMembers={user.canManageMembers} />

        <div className="rail-foot rl-foot" data-tour="foot">
          <div className="rl-user" title={`${user.name} · ${role}`}>
            <span className="rl-avatar" aria-hidden="true">{initials(user.name || user.email)}</span>
            <span className="rail-user rl-user-text">
              <b>{user.name}</b>
              <span>{role} · {user.email}</span>
            </span>
          </div>
          <div className="rl-foot-actions">
            <TourLauncher />
            <SignOut />
          </div>
        </div>
      </aside>
      <main className="main">
        <InviteBanner />
        {children}
      </main>
      <GuidedDemo />
    </div>
  );
}
