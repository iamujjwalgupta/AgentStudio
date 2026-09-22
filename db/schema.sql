-- Agent Studio schema. Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null default 'builder' check (role in ('admin','builder','approver')),
  created_at    timestamptz not null default now()
);

-- The workspace owner: the account that created it. Distinct from the 'admin'
-- role, of which there may eventually be several. Only the owner may delete an
-- agent. Backfilled to the earliest admin, else the earliest member.
alter table orgs add column if not exists owner_id uuid references users(id);
update orgs o set owner_id = (
  select u.id from users u where u.org_id = o.id
   order by (u.role = 'admin') desc, u.created_at asc limit 1
) where o.owner_id is null;

-- Who may see a workspace, and as what. This is the authority for access and
-- role; users.org_id is only the workspace that person originally created.
-- A person may belong to several workspaces and switch between them.
create table if not exists memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,
  role       text not null default 'builder' check (role in ('admin','builder','approver')),
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

-- Everyone who existed before memberships keeps exactly the access they had.
insert into memberships (user_id, org_id, role)
  select u.id, u.org_id, u.role from users u
  on conflict (user_id, org_id) do nothing;

-- Which of their workspaces the person is currently looking at.
alter table users add column if not exists active_org_id uuid references orgs(id) on delete set null;
update users set active_org_id = org_id where active_org_id is null;

create index if not exists idx_memberships_user on memberships (user_id);
create index if not exists idx_memberships_org  on memberships (org_id);

-- An invitation to join a workspace. Works whether or not the address already
-- has an account: with one, they accept in the app; without, the token carries
-- them through sign-up into this workspace instead of a new one.
create table if not exists invitations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  email           text not null,
  role            text not null default 'builder' check (role in ('admin','builder','approver')),
  token           text not null unique,
  invited_by      uuid references users(id) on delete set null,
  invited_by_name text not null default '',
  status          text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid references users(id) on delete set null
);

-- One standing invitation per address per workspace.
create unique index if not exists uniq_invite_pending
  on invitations (org_id, lower(email)) where status = 'pending';
create index if not exists idx_invitations_email on invitations (lower(email), status);

-- Connections are provisioned once and referenced by agents. Secrets are
-- encrypted at rest with APP_SECRET and never returned to the browser.
create table if not exists connections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('postgres','http','smtp','slack','files','anthropic')),
  config      jsonb not null default '{}'::jsonb,
  secret_enc  text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

-- Drop restrictive kind check constraint to allow any enterprise connector or custom MCP server.
alter table connections drop constraint if exists connections_kind_check;

-- Inbound Webhooks logged per connection for agent triggers & event streaming
create table if not exists connection_webhooks (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references connections(id) on delete cascade,
  event_type     text not null default 'custom.event',
  payload        jsonb not null default '{}'::jsonb,
  headers        jsonb not null default '{}'::jsonb,
  status         text not null default 'processed',
  created_at     timestamptz not null default now()
);

create index if not exists idx_connection_webhooks_conn
  on connection_webhooks (connection_id, created_at desc);

-- One model key per workspace: the runtime must never have to choose between two.
create unique index if not exists uniq_conn_anthropic_per_org
  on connections (org_id) where kind = 'anthropic';

create table if not exists agents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  archetype       text not null default 'analyst',
  status          text not null default 'draft' check (status in ('draft','published','retired')),
  owner_id        uuid references users(id),
  draft_spec      jsonb not null,
  published_ver   int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Scheduling state. The typed sentence lives in the spec; these columns hold
-- what the scheduler derived from it and when the agent is next due. Only a
-- published agent ever carries a next_run_at.
alter table orgs   add column if not exists timezone        text not null default 'UTC';
alter table agents add column if not exists schedule        jsonb;
alter table agents add column if not exists schedule_caveat text not null default '';
alter table agents add column if not exists next_run_at     timestamptz;
alter table agents add column if not exists last_run_at     timestamptz;

create index if not exists idx_agents_due on agents (next_run_at) where next_run_at is not null;

create table if not exists agent_versions (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  version     int not null,
  spec        jsonb not null,
  note        text not null default '',
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  unique (agent_id, version)
);

create table if not exists runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  agent_id     uuid not null references agents(id) on delete cascade,
  version      int,
  spec         jsonb not null,
  status       text not null default 'running'
               check (status in ('running','awaiting_approval','completed','failed','rejected')),
  trigger      text not null default 'manual',
  input        text not null default '',
  state        jsonb not null default '[]'::jsonb,
  output       text,
  error        text,
  started_by   uuid references users(id),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  input_tokens int not null default 0,
  output_tokens int not null default 0
);

-- Spend. Cache tokens are billed at different rates from fresh input, so they
-- are recorded separately. Cost is computed when the run finishes and stored,
-- so changing the rate table never rewrites what past runs actually cost.
alter table runs add column if not exists model              text;
alter table runs add column if not exists cache_read_tokens  int not null default 0;
alter table runs add column if not exists cache_write_tokens int not null default 0;
alter table runs add column if not exists cost_usd           numeric(12,6) not null default 0;

-- Monthly ceiling for the workspace, in US dollars. Null means no limit.
alter table orgs add column if not exists monthly_cap_usd numeric(10,2);

create index if not exists idx_runs_org_month on runs (org_id, started_at desc);

-- Held by whichever worker is currently stepping this run. A lease rather than
-- a lock, so a crashed worker's run becomes claimable again instead of wedging.
alter table runs add column if not exists locked_at timestamptz;

-- A rehearsal. Consequential actions are described rather than carried out, so
-- an agent can be seen working before it is published and gated.
alter table runs add column if not exists dry_run boolean not null default false;

-- What the person filled in on the run form, keyed by input key. Recorded so a
-- run can be read back knowing exactly what it was given.
alter table runs add column if not exists inputs jsonb not null default '{}'::jsonb;

-- Hierarchical multi-agent delegation: links a child run to its invoking parent run.
alter table runs add column if not exists parent_run_id uuid references runs(id) on delete set null;
create index if not exists idx_runs_parent on runs (parent_run_id);

create table if not exists run_steps (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references runs(id) on delete cascade,
  idx         int not null,
  kind        text not null check (kind in ('model','tool','approval','output')),
  tool        text,
  title       text not null default '',
  input       jsonb,
  output      jsonb,
  status      text not null default 'ok',
  duration_ms int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists approvals (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references runs(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  tool         text not null,
  tool_use_id  text not null,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  comment      text,
  decided_by   uuid references users(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Agents sent to a user in another workspace. The spec is snapshotted at send
-- time, so the offer is unaffected by later edits to the source agent, and
-- survives its deletion. Nothing enters the recipient's workspace until they
-- accept; on accept the spec is copied with its sources stripped, because
-- connection ids are meaningless outside the workspace that owns them.
create table if not exists agent_shares (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid references agents(id) on delete set null,
  agent_name        text not null,
  spec              jsonb not null,
  source_version    int,
  from_org_id       uuid not null references orgs(id) on delete cascade,
  from_user_id      uuid references users(id) on delete set null,
  from_user_name    text not null default '',
  from_org_name     text not null default '',
  to_user_id        uuid not null references users(id) on delete cascade,
  to_org_id         uuid not null references orgs(id) on delete cascade,
  note              text not null default '',
  status            text not null default 'pending'
                    check (status in ('pending','accepted','declined','revoked')),
  accepted_agent_id uuid references agents(id) on delete set null,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);

-- The same agent cannot be offered to the same person twice while one offer stands.
create unique index if not exists uniq_share_pending
  on agent_shares (agent_id, to_user_id) where status = 'pending';
create index if not exists idx_shares_in on agent_shares (to_user_id, status, created_at desc);
create index if not exists idx_shares_out on agent_shares (from_org_id, created_at desc);

-- A decision taken by the same person who started the run. Only possible when
-- nobody else is eligible to decide; recorded so it is never invisible.
alter table approvals add column if not exists self_approved boolean not null default false;

-- Which events the workspace wants to hear about, and where. Absent keys mean
-- the default in src/lib/notify.ts applies.
alter table orgs add column if not exists notify jsonb not null default '{}'::jsonb;

-- Every delivery attempt, so a notification that never arrived can be explained
-- rather than guessed at. Delivery failures never fail the thing they report.
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  event      text not null,
  channel    text not null check (channel in ('email','slack')),
  recipient  text not null default '',
  subject    text not null default '',
  status     text not null default 'sent' check (status in ('sent','failed','skipped')),
  detail     text not null default '',
  entity_id  text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_org on notifications (org_id, created_at desc);

-- Append-only. No update or delete path exists in the application.
create table if not exists audit_events (
  id         bigserial primary key,
  org_id     uuid not null,
  actor_id   uuid,
  actor_name text not null default 'system',
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  mime        text not null default '',
  path        text not null,
  size_bytes  int not null default 0,
  uploaded_by uuid references users(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_agents_org on agents(org_id);
create index if not exists idx_runs_agent on runs(agent_id, started_at desc);
create index if not exists idx_steps_run on run_steps(run_id, idx);
create index if not exists idx_approvals_status on approvals(org_id, status);
create index if not exists idx_audit_org on audit_events(org_id, at desc);

-- Skills: reusable know-how, written once in the workspace and attached to any
-- number of agents. A skill is not a capability — tools decide what an agent may
-- do, skills describe how the work is done here. Agents reference them by id
-- from the spec, so versioning, diffing and publishing need no new machinery.
create table if not exists skills (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  -- The handle the agent passes to load_skill. Slugged, so it is unambiguous.
  name         text not null,
  label        text not null default '',
  -- The one line that sits in every attached agent's system prompt.
  description  text not null default '',
  -- The body, markdown, loaded on demand rather than pasted into every prompt.
  instructions text not null default '',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Two skills answering to the same name would make load_skill a coin toss.
create unique index if not exists uniq_skill_name_per_org on skills (org_id, name);
create index if not exists idx_skills_org on skills (org_id, updated_at desc);

-- Embedded Web Applications: external portals, custom agent interfaces,
-- dashboards, and operational tools embedded directly in Agent Studio canvas.
create table if not exists apps (
  id           text not null default gen_random_uuid()::text,
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  url          text not null,
  category     text not null default 'general',
  icon         text not null default 'globe',
  display_mode text not null default 'canvas',
  permissions  text not null default 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads',
  position     integer not null default 0,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id, org_id)
);

create index if not exists idx_apps_org on apps (org_id, position asc, updated_at desc);

create table if not exists workspace_hidden_apps (
  org_id     uuid not null references orgs(id) on delete cascade,
  app_id     text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, app_id)
);
create index if not exists idx_workspace_hidden_apps_org on workspace_hidden_apps (org_id);
