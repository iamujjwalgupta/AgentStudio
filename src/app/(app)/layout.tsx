import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import SignOut from "@/components/SignOut";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import InviteBanner from "@/components/InviteBanner";
import GuidedDemo, { TourLauncher } from "@/components/GuidedDemo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  let pending = 0;
  let shares = 0;
  try {
    const r = await q<any>(
      `select count(*)::int as n from approvals where org_id = $1 and status = 'pending'`,
      [user.orgId],
    );
    pending = r[0]?.n ?? 0;
    const sh = await q<any>(
      `select count(*)::int as n from agent_shares where to_user_id = $1 and status = 'pending'`,
      [user.id],
    );
    shares = sh[0]?.n ?? 0;
  } catch {
    /* database not reachable yet — the pages will surface it */
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand" data-tour="brand">
          <span className="brand-mark" />
          <div className="brand-name">Agent Studio</div>
          <div className="eyebrow">{user.orgName}</div>
          <WorkspaceSwitcher memberships={user.memberships} activeOrgId={user.orgId} />
        </div>

        <nav className="nav">
          <div className="eyebrow nav-head bare">Build</div>
          <Link className="nav-item" href="/agents" data-tour="agents">
            <span className="nav-code">01</span>
            <span className="nav-label">Agents</span>
          </Link>
          <Link className="nav-item" href="/skills" data-tour="skills">
            <span className="nav-code">02</span>
            <span className="nav-label">Skills</span>
          </Link>
          <Link className="nav-item" href="/apps" data-tour="apps">
            <span className="nav-code">03</span>
            <span className="nav-label">Apps</span>
          </Link>
          <Link className="nav-item" href="/sandbox" data-tour="sandbox">
            <span className="nav-code">04</span>
            <span className="nav-label">Sandbox</span>
          </Link>
          <Link className="nav-item" href="/connections" data-tour="connections">
            <span className="nav-code">05</span>
            <span className="nav-label">Connections</span>
          </Link>

          <div className="eyebrow nav-head bare">Operate</div>
          <Link className="nav-item" href="/approvals" data-tour="approvals">
            <span className="nav-code">06</span>
            <span className="nav-label">Approvals</span>
            {pending > 0 && <span className="nav-badge">{pending}</span>}
          </Link>

          <div className="eyebrow nav-head bare">Activity &amp; Monitoring</div>
          <Link className="nav-item" href="/runs" data-tour="runs">
            <span className="nav-code">07</span>
            <span className="nav-label">Runs</span>
          </Link>
          <Link className="nav-item" href="/spend" data-tour="spend">
            <span className="nav-code">08</span>
            <span className="nav-label">Spend</span>
          </Link>
          <Link className="nav-item" href="/audit" data-tour="audit">
            <span className="nav-code">09</span>
            <span className="nav-label">Audit trail</span>
          </Link>

          <div className="eyebrow nav-head bare">Workspace</div>
          <div className="nav-icon-grid">
            <Link className="nav-icon-card" href="/shares" data-tour="shares" title="Agent Shares">
              <span className="nav-icon-symbol">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </span>
              <span className="nav-icon-label">Shares</span>
              {shares > 0 && <span className="nav-icon-badge">{shares}</span>}
            </Link>
            {user.canManageMembers && (
              <Link className="nav-icon-card" href="/members" data-tour="members" title="Workspace Members">
                <span className="nav-icon-symbol">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <span className="nav-icon-label">Members</span>
              </Link>
            )}
          </div>
        </nav>

        <div className="rail-foot" data-tour="foot">
          <div className="rail-actions-row">
            <TourLauncher />
          </div>
          <div className="eyebrow" style={{ marginTop: 10 }}>Signed in as</div>
          <div>{user.name}</div>
          <div className="mono sub-line" style={{ color: "var(--sky-3)" }}>{user.role}</div>
          <SignOut />
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
