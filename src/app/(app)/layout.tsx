import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  let pending = 0;
  try {
    const r = await q<any>(
      `select count(*)::int as n from approvals where org_id = $1 and status = 'pending'`,
      [user.orgId],
    );
    pending = r[0]?.n ?? 0;
  } catch {
    /* database not reachable yet — the pages will surface it */
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" />
          <div className="brand-name">Agent Studio</div>
          <div className="eyebrow">{user.orgName}</div>
        </div>

        <nav className="nav">
          <div className="eyebrow nav-head bare">Build</div>
          <Link className="nav-item" href="/agents">
            <span className="nav-code">01</span>
            <span className="nav-label">Agents</span>
          </Link>
          <Link className="nav-item" href="/connections">
            <span className="nav-code">02</span>
            <span className="nav-label">Connections</span>
          </Link>

          <div className="eyebrow nav-head bare">Operate</div>
          <Link className="nav-item" href="/approvals">
            <span className="nav-code">03</span>
            <span className="nav-label">Approvals</span>
            {pending > 0 && <span className="nav-badge">{pending}</span>}
          </Link>
          <Link className="nav-item" href="/runs">
            <span className="nav-code">04</span>
            <span className="nav-label">Runs</span>
          </Link>
          <Link className="nav-item" href="/audit">
            <span className="nav-code">05</span>
            <span className="nav-label">Audit trail</span>
          </Link>
        </nav>

        <div className="rail-foot">
          <div className="eyebrow">Signed in as</div>
          <div>{user.name}</div>
          <div className="mono sub-line" style={{ color: "var(--sky-3)" }}>{user.role}</div>
          <SignOut />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
