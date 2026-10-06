# Agent Studio: Python + GCP Target Architecture and Migration Plan

_2026-09-23. Companion to `PRODUCTION_READINESS_REVIEW.md` (19 Sep) and `TECHNICAL_DESIGN_DOCUMENT.md`._

## 1. Decisions this plan is built on

| Decision | Choice |
|---|---|
| Audience | Internal users of the organisation only. No self-serve signup, no billing, no public API for outsiders. |
| Cloud | Google Cloud Platform. |
| Backend language | Python. FastAPI for the HTTP API, LangGraph for the agent runtime. |
| Database | PostgreSQL (Cloud SQL), fully async from the application. |
| Frontend | The existing Next.js/React UI is kept and moved onto the new API. It is not rewritten. |
| Product scope | Two things in one app: **(a) the agent builder and runtime** that exists today, and **(b) a marketplace** where the organisation's other deployed applications and agents are listed, launched and, where they speak A2A, invoked. |

What does not change: the product model. The `AgentSpec` as the single source of truth, draft/publish versioning with a diff, approval gates driven by tool risk, skills with progressive disclosure, spend caps, the audit trail, and "retire, don't delete". These are the strongest parts of the current app and are carried over as-is.

What changes: the language, the runtime architecture, and every item the production readiness review flagged critical or high. The rewrite is used to fix those by construction rather than porting them.

---

## 2. Target architecture on GCP

```
                         Users (org identity: Google Workspace or Entra ID)
                                         │
                          External HTTPS Load Balancer + Cloud Armor
                                         │
                              Identity-Aware Proxy (IAP)
                ┌────────────────────────┼─────────────────────────────┐
                │ /*                     │ /api/*                      │ other hosts
       ┌────────▼────────┐     ┌─────────▼─────────┐        ┌──────────▼───────────┐
       │ web: Next.js    │     │ api: FastAPI      │        │ Marketplace apps      │
       │ (Cloud Run)     │────►│ (Cloud Run)       │        │ (your other Cloud Run │
       │ UI only, no DB  │     │ validate, authz,  │        │ services, same IAP →  │
       └─────────────────┘     │ enqueue           │        │ single sign-on)       │
                               └──┬──────────┬─────┘        └──────────▲───────────┘
                     enqueue task │          │ SQL                     │ A2A calls
                        ┌─────────▼───┐   ┌──▼───────────────────┐     │
 Cloud Scheduler ──────►│ Cloud Tasks │   │ Cloud SQL Postgres 16 │     │
  (every minute,        └─────┬───────┘   │ app schema + LangGraph│     │
   OIDC-authenticated)        │ push      │ checkpoints           │     │
                     ┌────────▼──────────┐└──▲───────────────────┘     │
                     │ worker: LangGraph │───┘                         │
                     │ run engine        │─────────────────────────────┘
                     │ (Cloud Run)       │──► Claude on Vertex AI (model gateway)
                     └───────┬───────────┘──► Tools: web, SQL, email, Slack/Teams,
                             │                 Jira, GitHub, MCP (via safe egress)
                             ▼
                 Cloud Storage (uploads, artifacts) · Secret Manager · Cloud KMS
                 Cloud Logging · Cloud Trace (OpenTelemetry) · Error Reporting
```

### Services

| Service | Runs on | Responsibility |
|---|---|---|
| `web` | Cloud Run | Next.js UI. Renders pages and calls `/api/*`. Holds no database credentials. |
| `api` | Cloud Run | FastAPI. Authenticates (IAP), authorises (RBAC), validates, reads and writes Postgres, **enqueues** runs. Never executes an agent loop inside a request. |
| `worker` | Cloud Run (private, no public ingress) | Receives Cloud Tasks pushes and advances runs with LangGraph. Same container image as `api`, different entrypoint. |
| Scheduler | Cloud Scheduler | Calls `api` `/internal/cron` once a minute with a Google-signed OIDC token. Replaces `scripts/scheduler.mjs`. |

Both `web` and `api` sit behind **one load balancer on one domain** (`/api/*` routes to `api`, everything else to `web`). That removes CORS and cross-site cookie problems entirely.

### GCP building blocks

| Need | GCP service | Replaces today |
|---|---|---|
| Identity and SSO | IAP (with Google Workspace, or Workforce Identity Federation for Entra ID/Okta) | Email + password + bcrypt + home-grown JWT |
| Database | Cloud SQL for PostgreSQL 16, private IP, HA, PITR | Local Postgres |
| Queue | Cloud Tasks | Runs executing inside HTTP requests |
| Cron | Cloud Scheduler | `scripts/scheduler.mjs` |
| Files | Cloud Storage, per-org prefixes, signed URLs | `./storage` on local disk |
| Platform secrets | Secret Manager | `.env` |
| Tenant connection secrets | Cloud KMS envelope encryption | AES key derived from `AUTH_SECRET` |
| Model | Claude on Vertex AI (Anthropic API as a config alternative) | Anthropic API key in `.env` |
| Outbound traffic | Serverless VPC access + Cloud NAT (fixed egress IP) + app-level SSRF guard | Unrestricted `fetch` |
| Edge protection | Cloud Armor | None |
| Logs / traces / errors | Cloud Logging, Cloud Trace, Error Reporting via OpenTelemetry | `console.log` |
| Images | Artifact Registry | — |
| Infrastructure | Terraform | Manual |

---

## 3. Identity and access

Because every user is internal, the simplest strong design is to **let IAP do authentication for everything** — Agent Studio and every marketplace app.

- IAP sits in front of the load balancer. A user signs in once with the organisation identity and can then open Agent Studio and any marketplace app behind the same IAP without logging in again. This is what makes the marketplace feel like one product.
- FastAPI **verifies the signed IAP JWT** (`x-goog-iap-jwt-assertion`) on every request — signature, issuer and audience — and never trusts the plain email header alone. A request that bypasses the load balancer is therefore rejected.
- On first sign-in a `users` row is created from the verified email. There are no passwords in the database at all.
- **Authorisation stays in the app.** The roles that exist today are kept: workspace owner, `admin`, `builder`, `approver`. They can be granted directly or mapped from Google Groups / Entra groups (e.g. `agent-studio-approvers@`).
- One FastAPI dependency enforces permissions: `Depends(require(Permission.PUBLISH_AGENT))`. There is no route that checks access by hand, and a CI test enumerates every route and fails if one is missing a permission (health and the OIDC-authenticated internal endpoints are the only allowlisted exceptions).
- Local development uses a `DEV_AUTH=true` mode that injects a fixed identity, disabled by a startup check whenever `ENV != "local"`.

Open decision: **which identity provider** — Google Workspace directly, or Entra ID/Okta through Workforce Identity Federation. The application code is identical either way; only the IAP configuration differs.

---

## 4. Backend design (Python)

### Stack

| Concern | Choice |
|---|---|
| Web framework | FastAPI, Uvicorn |
| Validation / schemas | Pydantic v2 (`AgentSpec` becomes a Pydantic model with `schema_version`) |
| Settings | pydantic-settings, fail-fast on missing secrets at boot |
| Database access | SQLAlchemy 2.0 async ORM/Core on **psycopg 3 (async)** |
| Migrations | Alembic |
| Agent runtime | LangGraph + `langgraph-checkpoint-postgres` (`AsyncPostgresSaver`) |
| Model client | `langchain-anthropic` / `ChatAnthropicVertex`, wrapped by our own model gateway |
| HTTP client | httpx (async) behind a `safe_fetch` SSRF guard |
| GCP | `google-cloud-tasks`, `google-cloud-storage`, `google-cloud-kms`, `google-cloud-secret-manager` |
| Documents | pandas/openpyxl (CSV, XLSX), pypdf, python-docx |
| Logging / tracing | structlog (JSON) + OpenTelemetry |
| Tooling | uv, ruff, mypy (strict on `domain/` and `runtime/`), pytest + pytest-asyncio + testcontainers |

psycopg 3 is chosen over asyncpg so that the application and the LangGraph checkpointer share one driver and one connection pool configuration.

### Repository layout

```
backend/
  pyproject.toml
  alembic/                      # versioned migrations; 0001 = today's schema minus data backfills
  app/
    main.py                     # FastAPI app factory, middleware, routers
    config.py                   # pydantic-settings
    api/                        # thin routers: parse, authorise, call a service, return
      agents.py  runs.py  approvals.py  connections.py  skills.py
      members.py  spend.py  audit.py  documents.py  marketplace.py
      internal.py               # /internal/cron, /internal/tasks/* (OIDC-only)
    auth/                       # IAP JWT verification, current_user, permissions
    domain/                     # Pydantic models: AgentSpec, RunInput, ... (pure, no I/O)
    services/                   # business logic: publish, diff, admit_run, decide_approval ...
    repositories/               # all SQL; every query takes org_id
    runtime/                    # the agent engine
      graph.py                  # AgentSpec -> LangGraph StateGraph
      nodes.py                  # agent, gate, execute_tools, finalize
      tools/                    # one module per tool, common Tool protocol
      model_gateway.py          # metering, budgets, timeouts, retries
      swarm.py                  # multi-agent (router / parallel / sequential)
      skills.py                 # load_skill
    infra/                      # db session, storage (GCS/local), tasks (Cloud Tasks/inline), kms, secrets
    worker.py                   # entrypoint for the worker service
  tests/
    unit/  integration/  e2e/
```

Rules that keep it maintainable at scale:
- Routers never contain SQL or business logic.
- Repositories are the only place SQL lives, and every method takes `org_id`. A cross-tenant test suite seeds two workspaces and asserts that no route leaks between them.
- `domain/` has no I/O and is fully unit-tested.
- Every infrastructure dependency has a local implementation (local disk storage, inline task execution) so the whole app runs on a laptop with only Postgres.

### API conventions

- REST under `/api/v1`, OpenAPI generated by FastAPI and used to **generate the TypeScript client** for the frontend, so the contract cannot drift.
- Errors as RFC 9457 `application/problem+json`.
- Starting a run returns `202 Accepted` with the run id; progress arrives over Server-Sent Events (`/api/v1/runs/{id}/events`), backed by Postgres `LISTEN/NOTIFY`, replacing the current 2-second poll.
- Mutating endpoints that start work accept an `Idempotency-Key`.

---

## 5. The agent runtime on LangGraph

This is where LangGraph earns its place: the current hand-written orchestrator persists message history in `runs.state`, pauses at approval gates and resumes later. LangGraph provides exactly that — durable checkpoints and human-in-the-loop interrupts — as a framework.

### Compiling a spec into a graph

Each published `AgentSpec` version is compiled into a graph (cached by version):

```
            ┌──────────┐
  START ──► │ prepare  │  build system prompt from spec (pure function, as today),
            └────┬─────┘  load run inputs, attach skill summaries, apply DLP
                 ▼
            ┌──────────┐   model call through the gateway
      ┌────►│  agent   │   (budget reserve → call → meter usage)
      │     └────┬─────┘
      │          │ tool calls?  no ──────────────────────────┐
      │          ▼ yes                                        │
      │     ┌──────────┐  effective gate per call =           │
      │     │   gate   │  max(spec gate, minimum for risk)    │
      │     └────┬─────┘  approval needed → interrupt()       │
      │          ▼        (run parks as awaiting_approval)    │
      │     ┌──────────────┐  executes approved/auto calls,   │
      └─────┤ execute_tools │  records rejected ones as        │
            └──────────────┘  "not performed" for the model   │
                                                              ▼
                                                        ┌──────────┐
                                                        │ finalize │ → END
                                                        └──────────┘
```

- **State** = messages, run inputs, step counter, pending approvals, cost so far.
- **Checkpointer** = `AsyncPostgresSaver` in Cloud SQL, `thread_id = run_id`. A run can wait at a gate for days and resume on any worker instance.
- **Approvals**: the `gate` node calls `interrupt()` with a *description of exactly what will run* (recipient, URL, SQL, payload). The decision endpoint records it and enqueues a resume task that calls the graph with `Command(resume=decision)`. The executed call must match what was approved (hash check), which closes the review finding that approvers could not see what they were approving.
- **Step limits, rehearsal (dry run), DLP, citations, stay-in-scope** map to graph config and the `prepare`/`gate` nodes exactly as the current spec fields describe.
- **Skills**: `load_skill` stays an implicit tool that returns a skill body on demand.
- **Swarm**: `router` uses a supervisor node with conditional edges; `parallel` uses LangGraph `Send` fan-out; `sequential` is a chain. Internal workers are sub-graphs; external workers are A2A calls (see marketplace).

### Correctness rules the runtime must follow

LangGraph re-executes a node from its beginning when it resumes after an `interrupt()`. Side effects therefore need care:

1. **The `gate` node is pure.** It decides and interrupts; it never performs a tool call.
2. **Tool execution is write-ahead and idempotent.** Before a consequential tool runs, a `run_steps` row is inserted with `unique(run_id, tool_call_id)`. If a worker crashes and the step is retried, a started-but-unfinished consequential step becomes `outcome_unknown` for a human to decide; it is never silently re-sent.
3. **One worker per run at a time.** The existing lease pattern (compare-and-set on `runs.locked_at`) is kept on top of Cloud Tasks at-least-once delivery.
4. **Time-sliced execution.** A worker advances a run for at most ~10 minutes, checkpoints, and re-enqueues itself. No request ever approaches Cloud Run or Cloud Tasks deadlines, and deploys never lose work.
5. **Recovery.** A reaper job re-enqueues runs whose lease expired and fails runs past a wall-clock limit.

### `run_steps` is kept alongside checkpoints

Checkpoints are the engine's internal state. `run_steps`, `approvals`, `audit_events` and the cost columns on `runs` remain the **human-readable record** the UI and auditors use. The runtime writes both.

### Model gateway

Every model call — agent turns, the brief compiler, skill drafting — goes through one function:

- chooses Vertex AI or the Anthropic API per configuration (and per-workspace override, as today);
- reserves budget against the workspace's monthly cap **before** the call, so concurrent runs cannot overshoot;
- applies timeouts and retries on retryable errors only;
- writes a `usage_events` row with tokens and cost priced at call time (keeping the current "cost is stored, not recomputed" rule);
- uses prompt caching for the system prompt.

Model ids are configuration, not code. Note that Vertex AI model ids use a different format from Anthropic API ids, and model availability varies by Vertex region.

### Tools

The current ~20 tools are ported behind one protocol:

```python
class Tool(Protocol):
    id: str
    risk: Risk                  # low / medium / high → minimum gate
    input_model: type[BaseModel]
    async def describe_for_approval(self, args, ctx) -> ApprovalView: ...
    async def run(self, args, ctx) -> ToolResult: ...
```

| Group | Tools |
|---|---|
| Read / research | `web_search`, `fetch_url`, `read_document`, `sql_query`, `jira_search_issues`, `github_read_file`, `kv_get` |
| Write / act | `http_request`, `send_email`, `post_message` (Slack), `post_teams_message`, `jira_create_issue`, `github_create_issue`, `sql_execute`, `kv_set`, `write_file` |
| Platform | `invoke_agent`, `invoke_marketplace_agent` (A2A, new), `load_skill` |

All outbound network calls go through `safe_fetch`: DNS resolved once and pinned, private/link-local/metadata ranges denied, redirects re-checked per hop, response size and time caps. Customer SQL runs in a read-only transaction with a statement timeout unless the connection explicitly allows writes.

---

## 6. The marketplace

The current Apps page proxies other sites through Agent Studio's own origin. That design is the source of four of the seven critical findings (session cookie forwarded to third parties, unauthenticated catch-all routes, embedded pages with same-origin API access, an unchecked `postMessage` bridge). **It is not ported.** The marketplace is rebuilt as a registry.

### What a marketplace entry is

| Field | Purpose |
|---|---|
| name, description, icon, category, tags | Discovery |
| owner team, support contact | Accountability |
| `url` | Where the app lives (normally another Cloud Run service behind the same IAP) |
| `kind` | `web_app` (open it), `agent` (invoke it via A2A), or both |
| `agent_card_url` | For agents: the A2A agent card (`/.well-known/agent.json`) describing skills and inputs |
| visibility | Everyone, or specific groups |
| status | Healthy / degraded / down, from a scheduled health check |
| version, last deployed | Shown on the card |

### How users use it

- **Browse and search** the catalogue, filtered by category, team and status.
- **Launch** opens the app in a new tab. Because it sits behind the same IAP, the user is already signed in.
- **Embed** (optional, per entry) is allowed only for apps you control that send `Content-Security-Policy: frame-ancestors https://<agent-studio-domain>`. The iframe loads the app's own URL directly, with `sandbox`. No proxying, no cookie forwarding.
- **Use in an agent**: entries of kind `agent` appear in the builder as callable workers. Agent Studio calls them through A2A with a Google-signed service identity (the target verifies it), and the call is a gated tool like any other consequential action.

### Onboarding an existing application

1. Deploy it (or keep it) on Cloud Run behind the organisation's IAP.
2. Optionally expose an A2A agent card if it is an agent that others should be able to invoke.
3. Register it in the marketplace (form or API). The health checker starts polling it.

---

## 7. Frontend changes

The UI is kept; its data access changes.

- **Today several server components query Postgres directly** (for example the app layout counts pending approvals with SQL). In the new design `web` holds no database credentials; every page fetches from `api` through the generated TypeScript client.
- Client-side `fetch` calls in ~25 components are replaced with the generated client plus TanStack Query.
- Login, password and invitation-acceptance screens are removed (IAP handles sign-in).
- The Apps pages are replaced by the marketplace pages; the app proxy, `/assets/*` and `/api/v1/*` catch-all routes are deleted.
- Run progress uses SSE instead of polling.
- Next.js is upgraded to a currently supported major version as part of the move (14.2.35 carries known advisories).

---

## 8. Data and migration of existing data

- **Alembic `0001_baseline`** = the current `db/schema.sql` tables, minus the data backfills that re-grant revoked memberships on every run.
- **Dropped:** `users.password_hash`, `invitations` token flow (replaced by group-based or admin-granted membership), the runtime-DDL fallbacks in `apps.ts` and `evals.ts`.
- **Added:** `marketplace_entries`, `usage_events`, `idempotency_keys`, LangGraph checkpoint tables (created by the checkpointer's own setup), `outcome_unknown` step status.
- **Carried over unchanged:** orgs, memberships, agents, agent_versions, runs, run_steps, approvals, skills, connections (secrets re-encrypted under KMS), notifications, audit_events, documents (files copied from `./storage` to GCS).
- Existing published agents keep working: specs are read through the Pydantic `AgentSpec` model with upgrade-on-read, as `normaliseInputs` does today.
- A one-off migration script moves data from the current database into Cloud SQL and re-encrypts connection secrets.

---

## 9. Security baseline — how the review's critical findings are closed

| Review finding | How the new design closes it |
|---|---|
| App proxy forwards the session cookie to tenant URLs (open SSRF relay) | No proxy. Marketplace links out or embeds the app's own origin. |
| Unauthenticated `/assets` and `/api/v1` catch-alls | Deleted. Deny-by-default route inventory in CI. |
| Proxied HTML gets same-origin API access | No proxied HTML is ever served from the Agent Studio origin. |
| `postMessage` bridge accepts any origin | Removed; any future bridge checks `event.origin` against the registry. |
| Public invoke endpoint never checks the key | Every route requires a verified IAP identity or a Google-signed service identity. |
| Cron fallback lets any owner fire every tenant's agents | `/internal/cron` accepts only the Cloud Scheduler service account's OIDC token. |
| Schema re-run re-grants revoked memberships | Alembic migrations run once; no data backfills in DDL. |
| Hard-coded fallback secret signs sessions and encrypts credentials | No app-signed sessions (IAP). Credentials use KMS envelope encryption. Startup fails if config is missing. |
| Spec gates accepted verbatim from the client | Runtime enforces `max(spec gate, risk minimum)` regardless of the stored spec. |
| Runs execute inside HTTP requests | `api` only enqueues; `worker` executes in time slices with checkpoints. |

Further baseline: Cloud Armor in front, private Cloud SQL, least-privilege service accounts per service, Secret Manager for platform secrets, egress through Cloud NAT, dependency and container scanning in CI, and an external penetration test before wide internal rollout.

---

## 10. Engineering and operations

| Area | Practice |
|---|---|
| Source control | Monorepo (`backend/`, `frontend/`, `infra/`), protected `main`, PR review required |
| CI | ruff, mypy, pytest (unit + integration with a Postgres testcontainer), route-permission inventory test, cross-tenant test, frontend typecheck/lint/build, dependency audit (pip-audit, npm audit), secret scan, container scan |
| CD | Build once → Artifact Registry → deploy to `dev` automatically → `staging` → `prod` with manual approval; Alembic migration as a Cloud Run job before rollout; traffic splitting for rollback |
| Environments | `local`, `dev`, `staging`, `prod` — separate GCP projects |
| Infrastructure | Terraform for every resource |
| Observability | JSON logs with `request_id`, `org_id`, `run_id`; OpenTelemetry traces through api → task → worker → model/tool calls; dashboards and alerts on run failure rate, queue latency, model errors, spend per workspace |
| LLM tracing (optional) | Langfuse (self-hostable on GCP) or LangSmith for step-by-step model traces |
| Evals | A regression suite of representative agents and inputs run in CI against the model gateway before model or prompt changes ship |
| Runbooks | Stuck run, model outage, budget exceeded, rollback, restore from PITR |

### Local development

Runs on a laptop without Docker:
- the existing local PostgreSQL;
- `uv run uvicorn app.main:app --reload` for the API;
- `TASKS_BACKEND=inline` so runs execute in-process without Cloud Tasks;
- `STORAGE_BACKEND=local` for files;
- `DEV_AUTH=true` for identity;
- `npm run dev` for the frontend.

---

## 11. Migration plan

A staged migration, not a big-bang rewrite. The current TypeScript app stays runnable as the reference implementation until the new stack reaches parity; no further hardening effort is spent on it.

| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **0. Foundations** | 1–3 | Monorepo, FastAPI skeleton, config, async DB layer, Alembic baseline, IAP auth + dev auth, RBAC dependency, repositories for orgs/users/memberships, CI, Terraform for dev project, local run instructions | CI green; `/api/v1/me` works locally and on dev behind IAP; route-inventory and cross-tenant tests in place |
| **1. Run engine** | 4–8 | `AgentSpec` Pydantic model, spec → LangGraph compiler, checkpointer, model gateway (Vertex + Anthropic), tool protocol + read-only tools, then gated tools, approvals via interrupt/resume, write-ahead steps, leases, time-slicing, reaper, Cloud Tasks + inline executors, SSE events | An existing published agent runs end to end, pauses at a gate, resumes after approval on a different worker instance, and survives a worker kill mid-run |
| **2. Builder surfaces** | 9–11 | Agents CRUD, versions, publish with diff, retire/delete, brief compiler, run form inputs, documents on GCS, schedules + Cloud Scheduler | The builder and run pages in the Next.js UI work entirely against FastAPI |
| **3. Workspace surfaces** | 12–14 | Connections (KMS), skills, members/roles/groups, spend + caps, notifications, audit, sharing between workspaces | Feature parity with the TypeScript app for everything kept |
| **4. Marketplace** | 13–15 (overlaps) | Registry, health checks, launch/embed rules, A2A client + `invoke_marketplace_agent`, onboarding of the first existing apps | Existing deployed apps are listed, launch with SSO, and at least one is invoked by an agent |
| **5. Production hardening & launch** | 16–18 | Staging + prod projects, data migration from the current DB, load test, failure drills, penetration test, runbooks, dashboards/alerts | Internal rollout to the first user group |

**Estimate:** about 18 weeks with 3–4 engineers; roughly 26–28 weeks with 2. Phases 3 and 4 can overlap if the team has four people.

### Features to decide on explicitly

These exist in the current code but were flagged in the review as showing fabricated data or as unsafe. They are **not** in the parity scope above unless you choose to include them:

| Feature | Recommendation |
|---|---|
| Sandbox importers (LangChain, OpenAI, Google ADK, Foundry parsers) | Defer; rebuild later if people use them |
| Agent exporter (generates code for other platforms) | Defer |
| Playground trace, evals UI, connection health, OAuth connections, "Schedule publish" | Rebuild as real features after launch, or drop |
| Webhook triggers | Include in Phase 2 if agents need event triggers at launch |
| Public invoke API | Not needed for internal users; A2A between internal services replaces it |

---

## 12. Open decisions

1. **Identity provider:** Google Workspace, or Entra ID/Okta via Workforce Identity Federation.
2. **Model access:** Claude on Vertex AI (recommended for GCP billing and data residency) or the Anthropic API directly; and the Vertex region.
3. **Which deferred features** from section 11 are needed at launch.
4. **Team size and start date**, which set the timeline.
5. **Domain names** for Agent Studio and the marketplace apps (all behind one IAP-protected domain, or one per app).

## 13. Immediate next steps

1. Confirm the open decisions above.
2. Create the `backend/` skeleton (Phase 0) next to the current app so both run locally against the same Postgres during the transition.
3. Port the `AgentSpec` model and build the LangGraph runtime for one existing published agent as the first vertical slice — this validates the riskiest part of the design first.
