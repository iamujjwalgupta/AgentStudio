"use client";

import Link from "next/link";
import FinIcon from "./FinIcon";
import { useFinance } from "./FinanceProvider";
import { FinHead, OwnerTag, Signal, SignalLegend } from "./parts";
import {
  AGENTS, COMING_SOON_TOWERS, DEEPDIVES, DOMAIN, MATRICES, THEMES, THEME_L1_MAP,
  findBox, focusLevel, focusLevelSingle, streamHref, tilesFor,
  type MatrixConfig, type StreamParams, type Tower,
} from "@/lib/finance";

/**
 * The finance value stream, from L1 towers down to L3 activities. Where you are
 * lives in the address (tower, area, activity, theme, box), so the browser's
 * back button and shared links work at every level.
 */
export default function ValueStreamView(p: StreamParams) {
  const towers = (() => {
    const allowed = p.theme ? THEME_L1_MAP[p.theme] : null;
    return allowed ? DOMAIN.filter((d) => allowed.includes(d.id)) : DOMAIN;
  })();
  const theme = p.theme ? THEMES.find((t) => t.id === p.theme) : null;
  const tower = DOMAIN.find((d) => d.id === p.tower) || towers[0] || DOMAIN[0];
  const area = p.area ? tower.l2.find((a) => a.id === p.area) || null : null;
  const activity = area && p.activity ? area.l3.find((a) => a.id === p.activity) || null : null;
  const matrix = MATRICES[tower.id];
  const keep = { theme: p.theme };

  return (
    <div className="page fin">
      <FinHead
        eyebrow="Finance"
        title="Value stream"
        sub="The finance value chain from L1 towers down to L3 activities. Signals show where automation creates the most value first."
      >
        <Link href="/finance/challenges" className="btn btn-sm">Finance challenges</Link>
      </FinHead>

      <div className="fin-toolbar">
        <div className="chips fin-towers" role="tablist" aria-label="Finance towers">
          {towers.map((t) => {
            const soon = COMING_SOON_TOWERS.has(t.id);
            const on = t.id === tower.id;
            const dot = <span className={`fin-dot ${focusLevelSingle(t.priority)}`} aria-hidden="true" />;
            return soon ? (
              <span key={t.id} className="chip fin-chip-off" aria-disabled="true" title={`${t.name}: coming soon`}>
                {dot}
                {t.name}
                <span className="fin-soon">Soon</span>
              </span>
            ) : (
              <Link key={t.id} href={streamHref({ ...keep, tower: t.id })} role="tab" aria-selected={on} className={`chip${on ? " on" : ""}`}>
                {dot}
                {t.name}
              </Link>
            );
          })}
        </div>
        <SignalLegend />
      </div>

      {theme && (
        <div className="fin-filter">
          <span>Showing towers linked to <b>{theme.name}</b></span>
          <Link href={streamHref({ tower: tower.id })} className="icon-btn" aria-label="Show all towers">
            <FinIcon name="x" size={13} />
          </Link>
        </div>
      )}

      <nav className="fin-crumbs" aria-label="Where you are">
        <Link href={streamHref(keep)}>Finance landscape</Link>
        <span aria-hidden="true">›</span>
        {area ? <Link href={streamHref({ ...keep, tower: tower.id })}>{tower.name}</Link> : <b aria-current="page">{tower.name}</b>}
        {area && (
          <>
            <span aria-hidden="true">›</span>
            {activity ? <Link href={streamHref({ ...keep, tower: tower.id, area: area.id })}>{area.name}</Link> : <b aria-current="page">{area.name}</b>}
          </>
        )}
        {activity && (
          <>
            <span aria-hidden="true">›</span>
            <b aria-current="page">{activity.name}</b>
          </>
        )}
      </nav>

      {!area && (matrix ? <Matrix tower={tower} m={matrix} box={p.box} keep={keep} /> : <AreaGrid tower={tower} keep={keep} />)}

      {area && !activity && (
        <div className="fin-grid fin-grid-3">
          {area.l3.map((act) => (
            <Link key={act.id} href={streamHref({ ...keep, tower: tower.id, area: area.id, activity: act.id })} className="fin-card fin-heat">
              <Signal level={focusLevel(act.potential, act.impact)} />
              <b className="fin-heat-name">
                {act.name}
                {act.flagship && <span className="fin-star"><FinIcon name="star" size={11} filled /> Deep dive ready</span>}
              </b>
              <span className="fin-small dim">
                Automation potential <b>{act.potential}</b> · Business impact <b>{act.impact}</b>
              </span>
              <span className="fin-more">Open deep dive <FinIcon name="arrow-right" size={12} /></span>
            </Link>
          ))}
        </div>
      )}

      {activity && <DeepDiveView id={activity.id} />}
    </div>
  );
}

/* ── towers without a matrix: a grid of L2 areas ────────────────────────── */

function AreaGrid({ tower, keep }: { tower: Tower; keep: StreamParams }) {
  return (
    <div className="fin-grid fin-grid-3">
      {tower.l2.map((area) => (
        <div key={area.id} className="fin-card fin-heat">
          <Signal level={focusLevel(area.potential, area.impact)} />
          <Link href={streamHref({ ...keep, tower: tower.id, area: area.id })} className="fin-heat-name fin-stretch">
            {area.name}
          </Link>
          <div className="fin-l3s">
            {area.l3.slice(0, 5).map((act) => (
              <Link key={act.id} href={streamHref({ ...keep, tower: tower.id, area: area.id, activity: act.id })} className="fin-l3">
                <span className={`fin-dot ${focusLevel(act.potential, act.impact)}`} aria-hidden="true" />
                {act.name}
                {act.flagship && <FinIcon name="star" size={10} filled />}
              </Link>
            ))}
          </div>
          {area.l3.some((x) => x.flagship) && (
            <span className="fin-star"><FinIcon name="star" size={11} filled /> Deep dive ready</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── P2P, O2C and R2R: the value-chain matrix ───────────────────────────── */

function Matrix({ tower, m, box, keep }: { tower: Tower; m: MatrixConfig; box?: string | null; keep: StreamParams }) {
  const here = { ...keep, tower: tower.id };
  const found = box ? findBox(m, box) : null;
  if (found) return <AppTiles tower={tower} m={m} code={box!} found={found} here={here} />;

  return (
    <div className="panel fin-matrix">
      <div className="fin-matrix-scroll">
        <div className="fin-matrix-inner" style={{ ["--cols" as string]: m.columns.length }}>
          <div className="fin-phases">
            {m.phases.map((ph) => (
              <div key={ph.id} className="fin-phase" style={{ gridColumn: `span ${ph.columnIds.length}` }}>
                {ph.name}
              </div>
            ))}
          </div>
          <div className="fin-cols">
            {m.columns.map((col) => (
              <div key={col.code} className="fin-col">
                <Link href={streamHref({ ...here, box: col.code })} className="fin-col-head" title={`${col.code} ${col.name}: see its applications`}>
                  <span className="fin-col-count" title={`${col.assetCount} ${m.label} assets and agents`}>{col.assetCount}</span>
                  <span className="fin-code">{col.code}</span>
                  <span className="fin-col-name">{col.name}</span>
                </Link>
                {col.items.map((it) => (
                  <Link key={it.code} href={streamHref({ ...here, box: it.code })} className={`fin-box${m.starred(col, it) ? " starred" : ""}`} title={`${it.code} ${it.name}`}>
                    <span className="fin-code">{it.code}</span>
                    <span className="fin-box-name">{it.name}</span>
                    {it.badge != null && <span className="fin-box-count" title={`${it.badge} asset${it.badge === 1 ? "" : "s"}`}>{it.badge}</span>}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="fin-small dim fin-matrix-note">
        Select a sub-process or activity to see the applications and agents behind it. Numbers count the assets and agents available.
        {" "}<span className="fin-star-key">★</span> {m.starLabel}.
      </p>
    </div>
  );
}

function AppTiles({
  tower, m, code, found, here,
}: {
  tower: Tower; m: MatrixConfig; code: string; found: NonNullable<ReturnType<typeof findBox>>; here: StreamParams;
}) {
  const { openAgent, runAgent } = useFinance();
  const data = tilesFor(m, code);
  const name = found.item ? found.item.name : found.column.name;
  const assets = found.item?.badge || found.column.assetCount || 1;
  const blueprint = data.flagship ? streamHref({ theme: here.theme, tower: tower.id, area: data.subProcessId, activity: data.l3Id }) : null;

  return (
    <div className="fin-stack">
      <div className="panel fin-app-head">
        <div>
          <div className="fin-tags">
            <span className="tag static">{found.column.phase}</span>
            <span className="tag static">{assets} {m.label} asset{assets === 1 ? "" : "s"} and agents</span>
            {m.starred(found.column, found.item) && <span className="fin-star"><FinIcon name="star" size={11} filled /> {m.starLabel}</span>}
          </div>
          <h2 className="fin-app-title"><span className="fin-code">{code}</span> {name}</h2>
          <p className="sub">{data.description} Part of <b>{found.column.name}</b>.</p>
        </div>
        <div className="fin-row fin-app-actions">
          <Link href={streamHref(here)} className="btn btn-sm">
            <FinIcon name="arrow-left" size={13} /> Back to the {m.label} matrix
          </Link>
          {blueprint && (
            <Link href={blueprint} className="btn btn-primary btn-sm">
              Open the end-to-end blueprint <FinIcon name="arrow-right" size={13} />
            </Link>
          )}
        </div>
      </div>

      <div className="fin-section-head">
        <h2>Applications &amp; automation engines</h2>
        <span className="fin-count">{data.applicationTiles.length} solutions</span>
      </div>
      <div className="fin-grid fin-grid-2">
        {data.applicationTiles.map((app) => {
          const flagship = !!app.maturity?.includes("★");
          return (
            <article key={app.id} className={`panel fin-app${flagship ? " flagship" : ""}`}>
              <header className="fin-app-top">
                <div>
                  <div className="fin-tags">
                    <span className="tag static">{app.type}</span>
                    {flagship && <span className="fin-star"><FinIcon name="star" size={11} filled /> Flagship blueprint</span>}
                  </div>
                  <h3>{app.name}</h3>
                </div>
                <span className={`tag ${/prod|active/i.test(app.status) ? "green" : "static"}`}>{app.status}</span>
              </header>

              <ul className="fin-checks">
                {app.features.map((f, i) => (
                  <li key={i}><FinIcon name="check" size={13} />{f}</li>
                ))}
              </ul>

              {app.metrics && (
                <div className="fin-app-kpis">
                  {Object.entries(app.metrics).map(([k, v]) => (
                    <div key={k}>
                      <span>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
              )}

              {!!app.agents?.length && (
                <div className="fin-app-agents">
                  <div className="eyebrow bare">Agents inside</div>
                  <div className="fin-agent-chips">
                    {app.agents.map((aid) => {
                      const a = AGENTS.find((x) => x.id === aid);
                      return (
                        <span key={aid} className="fin-agent-chip">
                          <FinIcon name="bot" size={13} />
                          <button className="fin-agent-name" onClick={() => openAgent(aid)} title="See this agent's profile">{a ? a.name : aid}</button>
                          <button className="fin-run" onClick={() => runAgent(aid)} aria-label={`Run ${a ? a.name : aid}`} title="Run in the test sandbox (demo)">
                            <FinIcon name="play" size={10} filled />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <footer className="fin-row fin-app-foot">
                {app.agentUrl ? (
                  <a href={app.agentUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" title={`Open the live ${app.name} application in a new tab`}>
                    <FinIcon name="bot" size={13} /> Launch agent <FinIcon name="external" size={12} />
                  </a>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => runAgent(app.agents?.[0] || app.id)}>
                    <FinIcon name="bot" size={13} /> Launch agent
                  </button>
                )}
                {blueprint && <Link href={blueprint} className="btn btn-sm">Process deep dive</Link>}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ── L3 deep dive ───────────────────────────────────────────────────────── */

function DeepDiveView({ id }: { id: string }) {
  const { openAgent, runAgent, notify } = useFinance();
  const dd = DEEPDIVES[id];
  if (!dd) {
    return (
      <div className="empty fin-empty">
        <h3>Deep dive in progress</h3>
        <p>This activity is scored on the heatmap, but its automation blueprint is still being written.</p>
        <button className="btn" onClick={() => notify("Request noted. We'll let you know when this blueprint is ready.", "ok")}>
          Request this blueprint
        </button>
      </div>
    );
  }

  return (
    <div className="fin-stack">
      <div className="fin-theme">
        <span className="eyebrow bare">Value theme</span>
        <p><b>{dd.theme}.</b> {dd.gap}.</p>
      </div>

      <section className="fin-section">
        <div className="fin-section-head">
          <h2>Agent-based solution</h2>
          <span className="fin-count">each step and who does it</span>
        </div>
        <div className="panel fin-flush">
          <ol className="fin-flow">
            {dd.steps.map((s, i) => {
              const a = s.agent ? AGENTS.find((x) => x.id === s.agent) : null;
              return (
                <li key={i} className="fin-flow-row">
                  <span className="fin-step-n">{i + 1}</span>
                  <b>{s.t}</b>
                  <OwnerTag type={s.o} />
                  <span className="fin-flow-act">
                    {a ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => openAgent(a.id)}>{a.name}</button>
                        <button className="btn btn-sm" onClick={() => runAgent(a.id)} title="Run in the test sandbox (demo)">
                          <FinIcon name="play" size={10} filled /> Run
                        </button>
                      </>
                    ) : (
                      <span className="fin-small dim">{s.o === "Human" ? "A person decides" : "No agent assigned yet"}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className="fin-two">
        <section className="fin-section">
          <div className="fin-section-head"><h2>Today&rsquo;s friction</h2></div>
          <div className="panel">
            <ul className="fin-bullets">
              {dd.challenges.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        </section>
        <section className="fin-section">
          <div className="fin-section-head"><h2>Solution features</h2></div>
          <div className="panel">
            <ul className="fin-checks">
              {dd.features.map((f, i) => <li key={i}><FinIcon name="check" size={13} />{f}</li>)}
            </ul>
          </div>
        </section>
      </div>

      <section className="fin-section">
        <div className="fin-section-head"><h2>Business case</h2></div>
        <div className="fin-benefit">
          <div className="fin-stat big"><span>Estimated impact</span><b>{dd.benefit.k1}</b><span>{dd.benefit.l1}</span></div>
          <div className="fin-stat big"><span>Operational improvement</span><b>{dd.benefit.k2}</b><span>{dd.benefit.l2}</span></div>
        </div>
        <div className="subcard fin-calc-note">
          <p><b>How it&rsquo;s calculated:</b> {dd.benefit.calc}</p>
          <ul className="fin-bullets">
            {dd.benefit.assumptions.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      </section>

      <section className="fin-section">
        <div className="fin-section-head"><h2>Case study</h2></div>
        <div className="subcard fin-case">
          <span className="fin-avatar" aria-hidden="true">{dd.india.tag}</span>
          <div>
            <b>{dd.india.co}</b>
            <p>{dd.india.text}</p>
            <span className="fin-small dim">Source: {dd.india.src}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
