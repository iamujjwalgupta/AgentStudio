# Agent Studio

A no-code agent builder. A non-technical person describes work in plain language; the app compiles that into a versioned, governed agent that runs with real tools, pauses for human approval on anything consequential, and logs everything.

Domain-agnostic — nothing in the model, the tools, or the copy assumes finance.

---

## What's in the box

- **Multi-user with real auth.** Email + password (bcrypt), JWT session cookie, org-scoped data. First sign-up creates the workspace.
- **Postgres** as the system of record. Idempotent schema in `db/schema.sql`.
- **Brief → spec compiler.** A model call turns a paragraph into a structured `AgentSpec`, validated against the tools and connections the user actually has.
- **Six-step builder**: Brief · Data · Instructions · Actions · Trigger · Review.
- **Eight working tools**, listed below. Not stubs.
- **Approval gates.** Medium and high-risk actions stop mid-run, persist state, and wait for a decision. Rejection is fed back to the agent, which must finish without the action and say so.
- **Draft / publish with versioning.** Editing a published agent forks a draft; the live version keeps running. Every run stamps the version it used.
- **Audit trail.** Append-only record of workspace, agent, connection, run and approval events.

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

## Setup

Requires Node 20+ and Postgres 14+.

```bash
cp .env.example .env      # fill in DATABASE_URL, ANTHROPIC_API_KEY, AUTH_SECRET
npm install
npm run db:setup          # applies db/schema.sql, safe to re-run
npm run dev               # http://localhost:3000
```

Open the app, choose **Create a workspace**, and you're in. Add connections under Connections; they are encrypted at rest with `AUTH_SECRET` and never returned to the browser.

`ANTHROPIC_API_KEY` is required for the two model-backed paths: compiling a brief into a spec, and running an agent. Everything else works without it.

## Architecture

```
Browser ─── Next.js App Router (server components + route handlers)
                │
                ├── /api/compile      brief  → AgentSpec   (model call, schema-validated)
                ├── /api/agents       CRUD, publish, versions
                ├── /api/runs         start a run, poll its steps
                ├── /api/approvals    approve or reject a held action, resume the run
                ├── /api/connections  encrypted credential storage
                └── /api/documents    upload and parse
                │
         lib/orchestrator.ts ─── plan / act / observe loop
                │                 persists message history to runs.state so a run
                │                 can sit at an approval gate indefinitely and resume
                ├── lib/tools.ts   the eight executors above
                ├── lib/ai.ts      Anthropic client, deterministic system-prompt builder
                └── Postgres       orgs · users · connections · agents · agent_versions
                                   runs · run_steps · approvals · audit_events · documents
```

The spec is the source of truth. The runtime prompt is generated from it by a pure function — never written or edited by hand — which is what makes a run reproducible and reviewable against the version it ran on.

## Verified

Run live against Postgres 16 on 29 Aug:

- Production build compiles clean, `tsc --noEmit` clean
- `npm run db:setup` creates all ten tables
- Register → session cookie → authenticated page loads (`/agents`, `/runs`, `/audit` all 200)
- Agent created via API and persisted
- Connection stored with the secret encrypted at rest (verified by reading the column directly)
- Publishing an incomplete agent is refused with a plain-language reason
- Audit events written for workspace creation, sign-in, agent creation, connection creation
- After the design merge: `/agents`, `/connections`, `/approvals`, `/runs`, `/audit` all render 200, and the compiled stylesheet carries the palette, grid, mono face and sweep animation

Not exercised here, because they need your API key: the brief compiler and a full agent run with an approval gate. Both are wired and typecheck; run them first with `ANTHROPIC_API_KEY` set.

## The interface

The visual layer is the Claude Design direction, ported into `src/app/globals.css`:

- **Blueprint drafting grid** at 28px, on the paper background and inside the navigation.
- **KPMG palette** — `#00338d` primary, `#001f5c` deep, `#005eb8` links, `#00a3a1` for healthy, `#c6007e` reserved strictly for "a human is needed". Magenta never appears decoratively; when you see it, something is waiting on you.
- **IBM Plex Sans + IBM Plex Mono.** Mono carries identifiers, versions, timestamps and eyebrow labels.
- **Corner ticks** on every panel, drawn with pseudo-elements so no extra markup is needed.
- **The spec strip** — Sources → Instructions → Actions → Guardrails as linked capsules with dashed wires and a slow sweep along the base, filling in as the agent is built.

Every class name is semantic (`panel`, `btn`, `strip`, `table`, `chip`, `tl`, `approval`), so the stylesheet can be replaced again without touching a single component.
