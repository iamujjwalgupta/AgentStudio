"use client";

import { useState } from "react";
import NavIcon from "./NavIcon";

/** Read by the app layout, which renders the rail collapsed when this is "collapsed". */
const RAIL_COOKIE = "as_rail";

/**
 * Collapses the navigation rail to a strip of icons and back. The choice is kept in a
 * cookie rather than local storage so the server renders the right width on the next
 * page load and the rail never flashes open first.
 */
export default function RailToggle({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next = !collapsed;
    setCollapsed(next);
    e.currentTarget.closest(".shell")?.classList.toggle("rail-collapsed", next);
    document.cookie = `${RAIL_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button type="button" className="rail-toggle" onClick={toggle} aria-label={label} aria-expanded={!collapsed} title={label}>
      <NavIcon name="collapse" size={15} />
    </button>
  );
}
