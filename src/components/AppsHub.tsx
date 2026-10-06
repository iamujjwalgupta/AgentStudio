"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmbeddedApp } from "@/lib/apps";
import Pagination from "@/components/Pagination";
import AddAppModal from "./AddAppModal";
import { AppTile, CATEGORIES, MODES, categoryOf, hostOf, modeOf, type EmbedMode } from "./apps/AppVisuals";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CopyIcon, CrossIcon, EyeIcon, GridIcon, ListIcon, MoreIcon, PencilIcon, TrashIcon } from "./agent-ui";

interface AppsHubProps {
  initialApps: EmbeddedApp[];
  timezone?: string;
}

type View = "list" | "grid";
type Sort = "order" | "name" | "added" | "updated";
type Shortcut = "proxy" | "direct" | "sandboxed" | "recent" | "undescribed";

const STORE_KEY = "agent-studio.apps.view";
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const MONTH_MS = 30 * 864e5;

function NewTabIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </svg>
  );
}
function OpenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12" />
    </svg>
  );
}
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {[4, 8, 12].flatMap((y) => [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}
    </svg>
  );
}

function ModeLabel({ mode }: { mode: EmbedMode }) {
  return (
    <span className="al-lastrun" title={MODES[mode].body}>
      <span className={`al-dot ap-dot-${mode}`} />
      <span className="al-small">{MODES[mode].label}</span>
    </span>
  );
}
const CategoryTag = ({ category }: { category: string }) => {
  const c = categoryOf(category);
  return <span className="al-tag al-proc ap-cat-tag" style={{ ["--pc" as any]: c.colour }}>{c.short}</span>;
};

export default function AppsHub({ initialApps, timezone = "UTC" }: AppsHubProps) {
  const router = useRouter();
  const [apps, setApps] = useState<EmbeddedApp[]>(initialApps);
  const [view, setView] = useState<View>("list");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"" | EmbedMode>("");
  const [flag, setFlag] = useState<"" | "recent" | "undescribed">("");
  const [sort, setSort] = useState<Sort>("order");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [arranging, setArranging] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmbeddedApp | null>(null);
  const [removing, setRemoving] = useState<EmbeddedApp | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => setApps(initialApps), [initialApps]);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v === "grid" || v === "list") setView(v);
    } catch {
      /* private windows and blocked site data: the default stands */
    }
  }, []);
  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {}
  }
  useEffect(() => setPage(1), [term, category, mode, flag, sort, pageSize]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuFor) setMenuFor(null);
      else if (peekId) setPeekId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dateFmt = useMemo(() => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }), [timezone]);
  const day = (iso?: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
  const isBuiltin = (a: EmbeddedApp) => a.is_builtin || a.id.startsWith("builtin-");

  // ---- counts ---------------------------------------------------------------------
  const summary = useMemo(() => {
    const now = Date.now();
    const s = { proxy: 0, direct: 0, sandboxed: 0, recent: 0, undescribed: 0 };
    for (const a of apps) {
      s[modeOf(a.permissions)]++;
      if (!isBuiltin(a) && now - new Date(a.created_at).getTime() < MONTH_MS) s.recent++;
      if (!a.description?.trim()) s.undescribed++;
    }
    return s;
  }, [apps]);
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of apps) m[categoryOf(a.category).id] = (m[categoryOf(a.category).id] ?? 0) + 1;
    return m;
  }, [apps]);

  // ---- filtering ------------------------------------------------------------------
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const now = Date.now();
    const list = apps.filter(
      (a) =>
        (!category || categoryOf(a.category).id === category) &&
        (!mode || modeOf(a.permissions) === mode) &&
        (flag !== "recent" || (!isBuiltin(a) && now - new Date(a.created_at).getTime() < MONTH_MS)) &&
        (flag !== "undescribed" || !a.description?.trim()) &&
        (!needle || [a.name, a.description, a.url].some((v) => (v || "").toLowerCase().includes(needle))),
    );
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "added") return [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    if (sort === "updated") return [...list].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    return list;
  }, [apps, term, category, mode, flag, sort]);

  const total = shown.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const validPage = Math.min(page, totalPages);
  const rows = arranging ? shown : shown.slice((validPage - 1) * pageSize, validPage * pageSize);

  const activeShortcut: Shortcut | null = flag || (mode as Shortcut) || null;
  function shortcut(s: Shortcut) {
    if (activeShortcut === s) {
      setMode("");
      setFlag("");
      return;
    }
    if (s === "recent" || s === "undescribed") {
      setFlag(s);
      setMode("");
    } else {
      setMode(s);
      setFlag("");
    }
  }
  function clearAll() {
    setTerm("");
    setCategory("");
    setMode("");
    setFlag("");
  }
  const chips: { label: string; clear: () => void }[] = [
    ...(term.trim() ? [{ label: `“${term.trim()}”`, clear: () => setTerm("") }] : []),
    ...(category ? [{ label: categoryOf(category).label, clear: () => setCategory("") }] : []),
    ...(mode ? [{ label: MODES[mode].label, clear: () => setMode("") }] : []),
    ...(flag ? [{ label: flag === "recent" ? "Added this month" : "Missing a description", clear: () => setFlag("") }] : []),
  ];

  // ---- order ----------------------------------------------------------------------
  async function persistOrder(next: EmbeddedApp[]) {
    const appIds = next.map((a) => a.id);
    try {
      localStorage.setItem("agent-studio.apps.order", JSON.stringify(appIds));
    } catch {}
    setSaving(true);
    try {
      await fetch("/api/apps/reorder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appIds }) });
    } catch {
      /* the local order still applies */
    } finally {
      setSaving(false);
    }
  }
  function move(fromId: string, toIndex: number) {
    const from = apps.findIndex((a) => a.id === fromId);
    if (from < 0 || toIndex < 0 || toIndex >= apps.length || from === toIndex) return;
    const next = [...apps];
    const [m] = next.splice(from, 1);
    next.splice(toIndex, 0, m);
    const withPos = next.map((a, i) => ({ ...a, position: i }));
    setApps(withPos);
    persistOrder(withPos);
  }
  function toggleArrange() {
    if (!arranging) {
      clearAll();
      setSort("order");
      setPeekId(null);
    }
    setArranging(!arranging);
  }

  function saved(app: EmbeddedApp) {
    setApps((prev) => {
      const i = prev.findIndex((a) => a.id === app.id);
      if (i < 0) return [app, ...prev];
      const next = [...prev];
      next[i] = { ...prev[i], ...app };
      return next;
    });
    setNote(editing ? `Saved “${app.name}”.` : `Added “${app.name}”. Open it to check it loads inside Agent Studio.`);
  }
  const startEdit = (a: EmbeddedApp) => {
    setMenuFor(null);
    setEditing(a);
    setModalOpen(true);
  };
  const copyAddress = (a: EmbeddedApp) => {
    setMenuFor(null);
    navigator.clipboard?.writeText(a.url).then(() => setNote(`Copied the address of “${a.name}”.`)).catch(() => {});
  };

  // ---- row pieces -------------------------------------------------------------------
  const openPeek = (e: React.MouseEvent, a: EmbeddedApp) => {
    if (arranging || (e.target as HTMLElement).closest("a, button")) return;
    setPeekId(a.id);
  };

  function moreMenu(a: EmbeddedApp) {
    const open = menuFor === a.id;
    return (
      <div className="al-menu-wrap">
        <button
          className="icon-act"
          aria-label={`More actions for ${a.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title="More actions"
          onClick={(e) => {
            e.stopPropagation();
            setMenuFor(open ? null : a.id);
          }}
        >
          <MoreIcon />
        </button>
        {open && (
          <div className="al-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button role="menuitem" onClick={() => { setMenuFor(null); window.open(a.url, "_blank", "noopener"); }}>
              <NewTabIcon /> Open in a new tab
            </button>
            <button role="menuitem" onClick={() => copyAddress(a)}>
              <CopyIcon /> Copy address
            </button>
            <button role="menuitem" onClick={() => startEdit(a)}>
              <PencilIcon /> Edit
            </button>
            <div className="al-menu-sep" />
            <button role="menuitem" className="danger" onClick={() => { setMenuFor(null); setRemoving(a); }}>
              <TrashIcon /> Remove…
            </button>
          </div>
        )}
      </div>
    );
  }

  function actions(a: EmbeddedApp) {
    if (arranging) {
      const i = apps.findIndex((x) => x.id === a.id);
      return (
        <div className="al-actions">
          <span className="ap-grip" title="Drag to move"><GripIcon /></span>
          <button className={`icon-act ${view === "list" ? "ap-vertical" : ""}`} onClick={() => move(a.id, i - 1)} disabled={i === 0} title={view === "list" ? "Move up" : "Move earlier"} aria-label="Move earlier"><ArrowLeftIcon size={13} /></button>
          <button className={`icon-act ${view === "list" ? "ap-vertical" : ""}`} onClick={() => move(a.id, i + 1)} disabled={i === apps.length - 1} title={view === "list" ? "Move down" : "Move later"} aria-label="Move later"><ArrowRightIcon size={13} /></button>
        </div>
      );
    }
    return (
      <div className="al-actions">
        <Link href={`/apps/${a.id}`} className="btn sm al-run" title={`Open ${a.name} in Agent Studio`}>
          <OpenIcon /> Open
        </Link>
        <button className="icon-act" onClick={() => setPeekId(a.id)} aria-label={`Quick look at ${a.name}`} title="Quick look">
          <EyeIcon />
        </button>
        {moreMenu(a)}
      </div>
    );
  }

  const dragProps = (a: EmbeddedApp) =>
    arranging
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", a.id);
            setDragId(a.id);
          },
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            if (overId !== a.id) setOverId(a.id);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const src = dragId || e.dataTransfer.getData("text/plain");
            setDragId(null);
            setOverId(null);
            if (src && src !== a.id) move(src, apps.findIndex((x) => x.id === a.id));
          },
          onDragEnd: () => {
            setDragId(null);
            setOverId(null);
          },
        }
      : {};

  const shortcuts: { key: Shortcut; label: string; value: number; tone?: string }[] = [
    { key: "proxy", label: "Via Agent Studio", value: summary.proxy },
    { key: "direct", label: "Direct", value: summary.direct },
    ...(summary.sandboxed ? [{ key: "sandboxed" as Shortcut, label: "Sandboxed", value: summary.sandboxed }] : []),
    { key: "recent", label: "Added this month", value: summary.recent, tone: "ok" },
    { key: "undescribed", label: "Missing a description", value: summary.undescribed, tone: summary.undescribed ? "warn" : undefined },
  ];

  const peek = peekId ? apps.find((a) => a.id === peekId) ?? null : null;

  return (
    <div className="page ap">
      <header className="page-head">
        <div>
          <div className="eyebrow">Agent Studio</div>
          <h1>Apps</h1>
          <p className="sub" style={{ maxWidth: "none" }}>
            Your team&apos;s web apps, dashboards and agent front-ends, opened inside Agent Studio beside your agents.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add app</button>
        </div>
      </header>

      {note && (
        <div className="ap-note">
          <CheckIcon size={13} />
          <span className="grow">{note}</span>
          <button onClick={() => setNote("")} aria-label="Dismiss"><CrossIcon size={11} /></button>
        </div>
      )}

      {apps.length === 0 ? (
        <div className="empty">
          <h3>No apps yet</h3>
          <p>Add a web app, dashboard or agent front-end by its address, and open it here beside your agents.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>+ Add app</button>
          </div>
        </div>
      ) : (
        <>
          <div className="al-summary" role="group" aria-label="App summary">
            {shortcuts.map((s) => (
              <button
                key={s.key}
                className={`al-stat ${s.tone ?? ""} ${activeShortcut === s.key ? "on" : ""}`}
                onClick={() => shortcut(s.key)}
                aria-pressed={activeShortcut === s.key}
                disabled={arranging}
                title={activeShortcut === s.key ? "Show all again" : `Show ${s.label.toLowerCase()}`}
              >
                <span className="v">{s.value}</span>
                <span className="l">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="al-toolbar">
            <div className="al-toolbar-row">
              <input
                className="input search al-search"
                value={term}
                placeholder="Search by name, description or address"
                onChange={(e) => setTerm(e.target.value)}
                aria-label="Search apps"
                disabled={arranging}
              />
              <select className="select-sm" value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="How it loads" disabled={arranging}>
                <option value="">All load types</option>
                <option value="proxy">Via Agent Studio</option>
                <option value="direct">Direct</option>
                <option value="sandboxed">Sandboxed</option>
              </select>
              <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" disabled={arranging}>
                <option value="order">Custom order</option>
                <option value="name">Name (A–Z)</option>
                <option value="added">Newest first</option>
                <option value="updated">Recently updated</option>
              </select>
              <button
                type="button"
                className={`al-cycle-btn ${arranging ? "on" : ""}`}
                onClick={toggleArrange}
                aria-pressed={arranging}
                title={arranging ? "Finish arranging" : "Set the order everyone in the workspace sees"}
              >
                {arranging ? <><CheckIcon size={13} /> Done arranging</> : <><GripIcon /> Arrange</>}
              </button>
              <div className="seg" role="group" aria-label="Layout">
                {(["list", "grid"] as View[]).map((v) => {
                  const label = v === "list" ? "List" : "Grid";
                  return (
                    <button key={v} className={`seg-opt icon ${view === v ? "on" : ""}`} onClick={() => choose(v)} aria-pressed={view === v} aria-label={label} title={label}>
                      {v === "list" ? <ListIcon size={16} /> : <GridIcon size={16} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="al-toolbar-row">
              <div className="chips">
                <button className={`chip ${!category ? "on" : ""}`} onClick={() => setCategory("")} disabled={arranging}>
                  All categories <span className="al-n">{apps.length}</span>
                </button>
                {CATEGORIES.filter((c) => catCounts[c.id]).map((c) => (
                  <button key={c.id} className={`chip ${category === c.id ? "on" : ""}`} onClick={() => setCategory(category === c.id ? "" : c.id)} disabled={arranging}>
                    {c.short} <span className="al-n">{catCounts[c.id]}</span>
                  </button>
                ))}
              </div>
              <span className="al-count">
                {total} {total === 1 ? "app" : "apps"}
                {chips.length > 0 && <span className="dim"> of {apps.length}</span>}
                {!arranging && totalPages > 1 && <span className="dim"> · page {validPage} of {totalPages}</span>}
                {saving && <span className="spin" style={{ marginLeft: 8 }} aria-label="Saving" />}
              </span>
            </div>
            {chips.length > 0 && (
              <div className="al-active">
                {chips.map((c) => (
                  <button key={c.label} className="al-chip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
                    {c.label} <span aria-hidden="true">×</span>
                  </button>
                ))}
                <button className="link-btn" onClick={clearAll}>Clear all</button>
              </div>
            )}
            {arranging && (
              <div className="ap-arrange-bar">Drag apps, or use the arrows, to set the order everyone in the workspace sees. Changes save as you go.</div>
            )}
          </div>

          {total === 0 ? (
            <div className="empty">
              <h3>Nothing matches</h3>
              <p>No app matches those filters. Widen the search or clear them.</p>
              <button className="btn mt-s" onClick={clearAll}>Clear all filters</button>
            </div>
          ) : view === "list" ? (
            <div className="al-table ap-table" role="table">
              <div className="al-row al-head" role="row">
                <div>App</div>
                <div>Address</div>
                <div>Category</div>
                <div>Loads</div>
                <div>Added</div>
                <div />
              </div>
              {rows.map((a) => (
                <div
                  key={a.id}
                  className={`al-row ${peekId === a.id ? "peeked" : ""} ${arranging ? "ap-arranging" : ""} ${dragId === a.id ? "ap-dragging" : ""} ${overId === a.id && dragId !== a.id ? "ap-over" : ""}`}
                  role="row"
                  onClick={(e) => openPeek(e, a)}
                  {...dragProps(a)}
                >
                  <div className="al-main ap-main">
                    <AppTile icon={a.icon} category={a.category} size={34} />
                    <div className="ap-main-text">
                      <Link href={`/apps/${a.id}`} className="al-name" title={a.name} onClick={(e) => arranging && e.preventDefault()}>{a.name}</Link>
                      <div className="al-desc" title={a.description || undefined}>{a.description || "No description yet"}</div>
                    </div>
                  </div>
                  <div className="ap-host-cell" title={a.url}>{hostOf(a.url)}</div>
                  <div><CategoryTag category={a.category} /></div>
                  <div><ModeLabel mode={modeOf(a.permissions)} /></div>
                  <div className="al-small">{isBuiltin(a) ? <span className="dim">Sample app</span> : day(a.created_at)}</div>
                  {actions(a)}
                </div>
              ))}
            </div>
          ) : (
            <div className="al-cards">
              {rows.map((a) => {
                const c = categoryOf(a.category);
                return (
                  <div
                    key={a.id}
                    className={`al-card ap-card-agent ${arranging ? "ap-arranging" : ""} ${dragId === a.id ? "ap-dragging" : ""} ${overId === a.id && dragId !== a.id ? "ap-over" : ""}`}
                    style={{ ["--pc" as any]: c.colour }}
                    onClick={(e) => openPeek(e, a)}
                    {...dragProps(a)}
                  >
                    <div className="al-card-head">
                      <CategoryTag category={a.category} />
                      <ModeLabel mode={modeOf(a.permissions)} />
                    </div>
                    <div className="ap-card-name-row">
                      <AppTile icon={a.icon} category={a.category} size={36} />
                      <Link href={`/apps/${a.id}`} className="al-card-name" title={a.name} onClick={(e) => arranging && e.preventDefault()}>{a.name}</Link>
                    </div>
                    <p className="al-card-desc" title={a.description || undefined}>{a.description || "No description yet"}</p>
                    <div className="al-card-meta">
                      <span className="ap-host-cell" title={a.url}>{hostOf(a.url)}</span>
                    </div>
                    <div className="al-card-foot">
                      <span className="al-small dim">{isBuiltin(a) ? "Sample app" : `Added ${day(a.created_at)}`}</span>
                      {actions(a)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!arranging && total > 0 && (
            <Pagination
              currentPage={validPage}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              itemLabel="app"
              itemLabelPlural="apps"
            />
          )}
        </>
      )}

      {peek && (
        <QuickLook
          app={peek}
          position={apps.findIndex((a) => a.id === peek.id) + 1}
          count={apps.length}
          day={day}
          sample={isBuiltin(peek)}
          onClose={() => setPeekId(null)}
          onEdit={() => startEdit(peek)}
          onOpen={() => router.push(`/apps/${peek.id}`)}
        />
      )}

      <AddAppModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onCreated={saved}
        editingApp={editing}
      />

      {removing && (
        <RemoveDialog
          app={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            const next = apps.filter((a) => a.id !== removing.id);
            setApps(next);
            persistOrder(next);
            if (peekId === removing.id) setPeekId(null);
            setNote(`Removed “${removing.name}” from Apps. The app itself is untouched.`);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}

// ---- quick look ----------------------------------------------------------------

/** A side panel with what an app is and how it loads, without leaving the list. */
function QuickLook({
  app: a, position, count, day, sample, onClose, onEdit, onOpen,
}: {
  app: EmbeddedApp; position: number; count: number; day: (iso?: string | null) => string; sample: boolean;
  onClose: () => void; onEdit: () => void; onOpen: () => void;
}) {
  const [views, setViews] = useState<{ id: string; title: string; url: string }[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`agent_studio_bookmarks_${a.id}`) || "[]");
      setViews(Array.isArray(saved) ? saved.filter((b: any) => !(b.id === "b1" && b.url === a.url)) : []);
    } catch {
      setViews([]);
    }
  }, [a.id, a.url]);
  const m = modeOf(a.permissions);
  return (
    <>
      <div className="al-peek-back" onClick={onClose} />
      <aside className="al-peek" role="dialog" aria-label="App quick look">
        <div className="al-peek-head">
          <div className="eyebrow">Quick look</div>
          <button className="icon-act" onClick={onClose} aria-label="Close quick look" title="Close">✕</button>
        </div>
        <div className="al-peek-body">
          <div className="ap-peek-title">
            <AppTile icon={a.icon} category={a.category} size={44} />
            <h2 className="al-peek-title">{a.name}</h2>
          </div>
          <div className="al-peek-line">
            <CategoryTag category={a.category} />
            <ModeLabel mode={m} />
          </div>
          {a.description ? <p className="al-peek-desc">{a.description}</p> : <p className="al-peek-desc dim">No description yet. Add one so people know what it&apos;s for.</p>}

          <dl className="al-peek-facts">
            <dt>Address</dt>
            <dd><a href={a.url} target="_blank" rel="noreferrer" className="ap-peek-url">{a.url}</a></dd>
            <dt>Loads</dt>
            <dd>{MODES[m].label}<div className="al-small dim">{MODES[m].body}</div></dd>
            <dt>Added</dt>
            <dd>{sample ? "Sample app" : `${day(a.created_at)}${a.created_by_name ? ` by ${a.created_by_name}` : ""}`}</dd>
            <dt>Updated</dt>
            <dd>{day(a.updated_at)}</dd>
            <dt>Position</dt>
            <dd>{position} of {count}</dd>
          </dl>

          <div className="eyebrow al-peek-h">Your saved views ({views.length})</div>
          {views.length ? (
            <ul className="al-peek-list">
              {views.map((v) => (
                <li key={v.id}>
                  <span>{v.title}</span>
                  <span className="al-small dim ap-peek-url-short">{v.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="al-small dim">None yet. Save a view from inside the app to jump back to a page in it.</p>
          )}

          <div className="al-peek-foot">
            <button className="btn" onClick={onEdit}><PencilIcon size={13} /> Edit</button>
            <a className="btn" href={a.url} target="_blank" rel="noreferrer"><NewTabIcon size={13} /> New tab</a>
            <button className="btn btn-primary" onClick={onOpen}><OpenIcon /> Open</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---- dialogs ----------------------------------------------------------------------

function useEscape(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose, busy]);
}

function RemoveDialog({ app, onClose, onDone }: { app: EmbeddedApp; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEscape(onClose, busy);
  async function go() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/apps/${app.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "The app could not be removed.");
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-back" onMouseDown={() => !busy && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="ap-rm-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Remove app</div>
        <h2 id="ap-rm-title" style={{ margin: "2px 0 8px", fontSize: 17 }}>Remove “{app.name}”?</h2>
        <p className="help" style={{ marginTop: 0 }}>
          It disappears from Apps for everyone in this workspace. The app itself, at <code>{hostOf(app.url)}</code>, is not affected, and you can add it again at any time.
        </p>
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-danger-solid" onClick={go} disabled={busy}>{busy ? "Removing…" : "Remove app"}</button>
        </div>
      </div>
    </div>
  );
}
