# Agent Studio

A no-code agent builder. A non-technical person describes work in plain language; the app compiles that into a versioned, governed agent that runs with real tools, pauses for human approval on anything consequential, and logs everything.

Domain-agnostic — nothing in the model, the tools, or the copy assumes finance.

---

## What's in the box

- **Build and run are separate surfaces.** The six-step builder is for whoever designs the agent. Everyone else opens an agent, fills in a form generated from what that agent actually asks for, and runs it.
- **Multi-workspace membership.** A person can belong to several workspaces and switch between them. Joining one adds access; it never moves the workspace they already own.
- **Roles that decide things.** `admin`, `builder`, `approver`, plus a single workspace owner. The owner and admins invite and publish; the owner and approvers decide held actions; the owner alone deletes. Anyone may retire.
- **Postgres** as the system of record. Idempotent schema in `db/schema.sql`.
- **Brief → spec compiler.** A model call turns a paragraph into a structured `AgentSpec`, validated against the tools and connections the user actually has.
- **Eight working tools**, listed below. Not stubs.
- **Approval gates.** Medium and high-risk actions stop mid-run, persist state, and wait for a decision. Rejection is fed back to the agent, which must finish without the action and say so.
- **A scheduler.** Agents with a schedule actually fire, on their own, in the workspace's timezone.
- **Draft / publish with versioning, and a diff.** Every run stamps the version it used, and publishing shows what changes — with anything that loosens the agent's licence flagged first.
- **Retire rather than delete.** Retiring stops an agent and keeps every version, run and approval it produced. Deleting destroys that evidence, so it is owner-only and asks for a password.
- **Spend tracking with a ceiling.** Every run is priced when it finishes and stored. A workspace can set a monthly limit that refuses new runs and stops one already going.
- **Notifications.** The app tells people when an action is waiting, a run failed, an agent was shared, someone was invited, or the limit was reached — over the workspace's own email and Slack connections.
- **Audit trail.** Append-only record of workspace, membership, agent, connection, run, approval and spend events.

## Using an agent

This is the part a non-builder touches.

1. Open **Agents**, find one — search, filter by type or status, list or grid.
2. Press **Run**.
3. The form is generated from that agent's declared inputs: a file picker for a ledger or a statement, a number for a threshold, a date for a cut-off. Required fields block the run rather than letting the agent discover the gap halfway through.
4. **Rehearse** first if you want to see it work without consequences — it runs for real but describes gated actions instead of carrying them out, then still produces its deliverable.
5. Watch the run step by step. If it reaches a gated action it stops and waits for an approver.

Files uploaded on the form become documents the agent reads with its document tool; they are handed over by name rather than pasted into the context, so size is not a problem.

## Tools

| Tool | Risk | Needs | What it actually does |
|---|---|---|---|
| Search the web | low | — | Executed server-side by the Anthropic API |
| Fetch a web page | low | — | Retrieves a URL, extracts readable text |
| Query a database | low | Postgres connection | Read-only SQL; write statements blocked unless the connection allows them |
| Read an uploaded document | low | — | CSV, XLSX, PDF, DOCX, TXT parsing |
| Call an API | medium | REST connection | Any method against a base URL with stored auth headers |
| Send an email | medium | SMTP connection | Real send via nodemailer |
| Post to Slack | medium | Slack webhook | Real post |
| Write a file | low | — | Generates MD, TXT, CSV, DOCX or XLSX as a downloadable artifact |

Risk drives the default gate. Low risk runs automatically; medium and high cannot be published ungated.

**Connections are standing credentials** — a ledger database, a mailbox, a Slack channel — provisioned once and granted to agents. They are not where per-run data goes; that is what the run form is for. A workspace can also hold its own **Anthropic** connection, which overrides the server's key and lets it bring its own model.

## Setup

Requires Node 22.9+ and Postgres 14+.

```bash
cp .env.example .env      # DATABASE_URL, ANTHROPIC_API_KEY, AUTH_SECRET, CRON_SECRET, APP_URL
npm install
npm run db:setup          # applies db/schema.sql, safe to re-run
npm run dev               # http://localhost:3000
npm run scheduler         # second terminal — fires agents that are due
```

Open the app, choose **Create a workspace**, and you're in. Add connections under Connections; they are encrypted at rest with `AUTH_SECRET` and never returned to the browser.

`ANTHROPIC_API_KEY` is the fallback for workspaces without their own Anthropic connection. It is needed for the two model-backed paths — compiling a brief into a spec, and running an agent. Everything else works without it.

**The scheduler is a separate process.** It holds no schedule logic and touches no database: it wakes once a minute and asks `/api/cron` to fire whatever is due, authenticated with `CRON_SECRET`. The same endpoint works behind system cron or a platform scheduler instead, so the bundled process is a convenience rather than a dependency.

### Other scripts

```bash
node --env-file=.env scripts/seed-agents.mjs      # 50 ready-made finance agents
node --env-file=.env scripts/arm-schedules.mjs    # recompute schedules from published specs
```

Both are safe to re-run and take `--dry-run`.

## Deploying

The app runs as one long-lived Node process, not as serverless functions. Three things in the code decide that:

- **Uploads and artifacts are written to disk** under `STORAGE_DIR`. They need a persistent volume; an ephemeral filesystem loses a document between the upload and the agent reading it.
- **A run executes inside the request** (`maxDuration = 300`). A long agent outlives a typical serverless ceiling.
- **The connection pool is per process** (`max: 10`). One process is fine; many short-lived instances need a pooler.

A `Dockerfile` is included and builds an image that serves the app and, with a different command, runs the scheduler.

```bash
docker build -t agent-studio .
docker run -p 3000:3000 -v agent-storage:/data \
  -e DATABASE_URL=... -e AUTH_SECRET=... -e ANTHROPIC_API_KEY=... \
  -e CRON_SECRET=... -e APP_URL=https://your-host agent-studio
```

On a container host — Railway, Render, Fly — run two services from the same image:

| Service | Command | Notes |
|---|---|---|
| web | `npm run start` | Port 3000, volume mounted at `/data`, health check on `/api/health` |
| scheduler | `npm run scheduler` | No port, no volume. Set `APP_URL` to the web service |

Run `npm run db:setup` once against the production database before first boot; it is idempotent and safe to repeat on every deploy.

**`AUTH_SECRET` encrypts every stored connection secret.** Changing it after credentials exist makes them undecryptable. Generate it once, keep it, and never reuse the development value.

## How scheduling reads a sentence

Schedules are typed in English — "Every Monday at 08:00", "Every month on the first working day". `lib/schedule.ts` parses that into a firing rule and works out the next occurrence in the workspace timezone, handling daylight saving and month ends by walking the calendar rather than doing arithmetic on timestamps.

It is explicit about what it cannot honour. "Every month once results are final" names an event no clock can detect, so the monthly cadence is scheduled and the qualifier is reported back as a caveat rather than silently dropped. An agent that declares inputs also carries a caveat until standing values are set, because a scheduled run has nobody at the keyboard to fill in the form.

## Architecture

```
Browser ─── Next.js App Router (server components + route handlers)
                │
                ├── /api/compile      brief → AgentSpec   (model call, schema-validated)
                ├── /api/agents       CRUD, publish, retire, versions, diff
                ├── /api/runs         start a run from form values, poll its steps
                ├── /api/approvals    approve or reject a held action, resume the run
                ├── /api/cron         fire every agent that has come due
                ├── /api/connections  encrypted credential storage
                ├── /api/documents    upload and parse
                ├── /api/members      invitations, roles, membership
                ├── /api/shares       offer an agent to another workspace
                ├── /api/spend        month-to-date cost and the ceiling
                └── /api/notifications  which events go where, and whether they arrived
                │
         lib/orchestrator.ts ─── plan / act / observe loop
                │                 persists message history to runs.state so a run
                │                 can sit at an approval gate indefinitely and resume.
                │                 Entry is guarded by a lease, so the same run is
                │                 never stepped twice and its actions never repeat.
                ├── lib/tools.ts       the eight executors above
                ├── lib/ai.ts          Anthropic client, deterministic system-prompt builder
                ├── lib/run-input.ts   form values → the run's opening message
                ├── lib/schedule.ts    English → firing rule → next occurrence
                ├── lib/spec-diff.ts   what changed between two versions, and whether it loosens
                ├── lib/pricing.ts     tokens → cost, including the cache split
                ├── lib/notify.ts      delivery over the workspace's own connections
                └── Postgres           orgs · users · memberships · invitations · connections
                                       agents · agent_versions · agent_shares · runs · run_steps
                                       approvals · documents · notifications · audit_events
```

**The spec is the source of truth**, and the runtime prompt is generated from it by a pure function — never written or edited by hand. That is what makes a run reproducible and reviewable against the version it ran on, and it is why per-run form values go into the run's first message rather than into the system prompt: the prompt has to stay a function of the spec alone.

Two other invariants worth knowing:

- **A delivery failure never fails the thing it reports.** A run does not fail because the mail server is down. Every notification attempt is recorded, including the ones skipped for want of a connection.
- **Cost is priced when a run finishes and stored on the run.** Changing the rate table never rewrites what past runs actually cost.

## Governance

The parts that exist to stop the wrong thing happening:

- **Publishing is a separate duty from building.** Only the owner and admins can put an agent live, or restore a retired one — restoring goes live again, so it is gated the same way. Retiring is deliberately left open to everyone: a safety valve must never be harder to reach than the risky action it undoes.
- **Approving is a separate duty from building.** Only the workspace owner and holders of the `approver` role can decide a held action. The person who started a run cannot decide it while anyone else can — and when nobody else can, the decision goes through but is stamped as a self-approval in the record and the audit trail.
- **Publishing shows its consequences.** The review step diffs the draft against the live version and leads with anything that loosens the agent's licence: a gate dropped to automatic, a tool newly granted, a guardrail switched off, an agent becoming unattended.
- **Deletion is the exception.** Retire is the default and is reversible; deleting takes the run history with it, so it needs the owner and their password.
- **Sharing does not carry credentials.** An agent sent to another workspace arrives as a draft with its sources stripped, because connection ids mean nothing outside the workspace that owns them and secrets never leave it.

## Verified

Run live against Postgres 16 on 30 Aug. The build and `tsc --noEmit` are clean and the schema creates all fourteen tables. Beyond that:

- **Scheduling** — five simultaneous ticks on one due agent claimed it exactly once; 08:00 stays 08:00 across the October daylight-saving change; "last working day" resolves to 30 Jan, 27 Feb, 31 Mar, 30 Apr. A real agent fired from the scheduler process and ran to completion.
- **The run loop** — six concurrent claims on one run produced one winner; a stale lease is reclaimable after a crash, a fresh one is not stealable. Two approvals decided simultaneously executed their actions once each, not twice.
- **The run form** — a missing required field is refused by name; a CSV uploaded through the form was read by the agent, which produced a real report from its contents.
- **Approvals** — a builder and an admin were both refused; an approver decided; an approver who had started the run was refused while someone else could decide; a sole member's decision went through stamped as a self-approval.
- **Membership** — twenty paths, including a non-owner refused, an admin unable to change roles, the owner unable to remove themselves, and a member removed from one workspace keeping their own.
- **Sharing** — an agent carrying a Postgres source arrived in another workspace with zero sources and no trace of the connection id, then correctly refused to publish until the recipient granted their own.
- **Spend** — six cost calculations against published rates including both cache multipliers; a live run's 172 input and 4 output tokens priced at $0.000576, matching to six decimal places.
- **Notifications** — with no connection the feature still worked and logged `skipped`; with a deliberately broken SMTP it logged `failed` and the invitation was still created; with a working mail server the message arrived with a valid join link; three cap-blocked runs produced one notification, not three.
- **Version diff** — a gate downgrade, a tool grant, loosened guardrails and an agent becoming unattended were all classified as loosening; an inserted step reports as one addition rather than three changes.

Not exercised: the approval-waiting notification end to end, which needs a live run that reaches a gate. The code path is the same as the four that were exercised.

## The interface

The visual layer is the Claude Design direction, ported into `src/app/globals.css`:

- **KPMG palette** — `#00338d` primary, `#001f5c` deep, `#005eb8` links, `#00a3a1` for healthy, `#c6007e` reserved strictly for "a human is needed". Magenta never appears decoratively; when you see it, something is waiting on you. Destructive actions use a separate danger red, so "delete" never dilutes that signal.
- **IBM Plex Sans + IBM Plex Mono.** Mono carries identifiers, versions, timestamps and eyebrow labels.
- **Corner ticks** on every panel and card, drawn with pseudo-elements so no extra markup is needed. They carry the drafting language on their own; there is no ruled background.
- **The spec strip** — Sources → Instructions → Actions → Guardrails as linked capsules with dashed wires and a slow sweep along the base, filling in as the agent is built.

Every class name is semantic (`panel`, `btn`, `strip`, `table`, `chip`, `tl`, `approval`), so the stylesheet can be replaced again without touching a single component.

**Dates rendered in client components must use `lib/format.ts`**, never a bare `toLocale*`. A client component is rendered on the server too, and an unpinned locale makes the two disagree — which fails hydration.
