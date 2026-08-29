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

-- Connections are provisioned once and referenced by agents. Secrets are
-- encrypted at rest with APP_SECRET and never returned to the browser.
create table if not exists connections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('postgres','http','smtp','slack','files')),
  config      jsonb not null default '{}'::jsonb,
  secret_enc  text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

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
