-- OtherThing — initial Supabase schema (replaces Appwrite DB `otherthing_main`).
--
-- Access model:
--   * Every user is a Supabase Auth user (auth.users). The desktop app and the
--     headless node talk to PostgREST with the *publishable* key plus the user's
--     JWT, so row-level security below is the only thing guarding the data.
--   * Workspace-scoped tables are readable/writable by members of that workspace.
--   * On-chain mirror tables (tasks, ip_registrations, agreements,
--     agreement_signatures, smart_contracts) are keyed by chain data, not our
--     workspace UUIDs. The chain is public, so any signed-in user may read them
--     and insert/update rows; unique constraints make chain-sync idempotent.

create extension if not exists pgcrypto;

-- ─── Helpers ───────────────────────────────────────────────────────────────

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── Profiles ──────────────────────────────────────────────────────────────

create table public.user_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  avatar         text,
  bio            text,
  wallet_address varchar(42),
  chain_id       int,
  reputation     int not null default 0,
  total_earned   numeric not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.user_profiles (wallet_address, chain_id);
create trigger user_profiles_updated before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row for every new auth user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Workspaces & membership ───────────────────────────────────────────────

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  owner_id    uuid not null references auth.users(id) on delete cascade,
  is_private  boolean not null default true,
  invite_code text not null unique default lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.workspaces (owner_id);
create trigger workspaces_updated before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','admin','member','viewer')),
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

-- Membership check used by every workspace-scoped policy. SECURITY DEFINER so it
-- can read workspace_members without recursing into that table's own policies.
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  )
$$;

create or replace function public.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin')
  )
$$;

-- The creator becomes the owner member.
create or replace function public.handle_new_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
create trigger on_workspace_created after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- Join by invite code. Invite codes are the only way in, so this is SECURITY
-- DEFINER: a non-member cannot otherwise see the workspace row.
create or replace function public.join_workspace(code text) returns public.workspaces
language plpgsql security definer set search_path = public as $$
declare
  ws public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into ws from public.workspaces where invite_code = lower(trim(code));
  if not found then
    raise exception 'Invalid invite code';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, auth.uid(), 'member')
  on conflict do nothing;
  return ws;
end $$;

create or replace function public.regenerate_invite_code(ws uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := lower(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
begin
  if not public.is_admin(ws) then
    raise exception 'Only owners and admins can regenerate the invite code';
  end if;
  update public.workspaces set invite_code = code where id = ws;
  return code;
end $$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- owner_id check is needed for INSERT ... RETURNING: the owner-member row added
-- by the trigger isn't visible to is_member() within the same statement.
create policy "members read workspace" on public.workspaces
  for select using (owner_id = auth.uid() or public.is_member(id));
create policy "users create own workspace" on public.workspaces
  for insert with check (owner_id = auth.uid());
create policy "admins update workspace" on public.workspaces
  for update using (public.is_admin(id));
create policy "owner deletes workspace" on public.workspaces
  for delete using (owner_id = auth.uid());

create policy "members read membership" on public.workspace_members
  for select using (public.is_member(workspace_id));
create policy "leave or admin remove" on public.workspace_members
  for delete using (user_id = auth.uid() or public.is_admin(workspace_id));
create policy "admins change roles" on public.workspace_members
  for update using (public.is_admin(workspace_id));

-- Members can see each other's profiles; everyone sees their own.
alter table public.user_profiles enable row level security;
create policy "read own or co-member profiles" on public.user_profiles
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members a
      join public.workspace_members b on a.workspace_id = b.workspace_id
      where a.user_id = auth.uid() and b.user_id = user_profiles.user_id
    )
  );
create policy "update own profile" on public.user_profiles
  for update using (user_id = auth.uid());
create policy "insert own profile" on public.user_profiles
  for insert with check (user_id = auth.uid());

-- Public wallet → profile lookup (was an unauthenticated route). Returns only
-- non-sensitive fields.
create or replace function public.profile_by_wallet(addr text, chain int default null)
returns table (user_id uuid, display_name text, avatar text, wallet_address text, chain_id int, reputation int)
language sql stable security definer set search_path = public as $$
  select user_id, display_name, avatar, wallet_address, chain_id, reputation
  from public.user_profiles
  where lower(wallet_address) = lower(addr) and (chain is null or chain_id = chain)
  limit 1
$$;

-- ─── Workspace-scoped tables ───────────────────────────────────────────────
-- Each gets the same four member policies via the loop at the bottom.

create table public.workspace_flows (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null,
  description      text,
  flow             jsonb,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  uaf_enabled      boolean not null default false,
  uaf_architecture jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.workspace_flows (workspace_id);

create table public.uaf_elements (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  local_id     text,
  name         text not null,
  description  text,
  viewpoint    text not null,
  model_kind   text not null,
  element_type text not null,
  properties   jsonb,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.uaf_elements (workspace_id, viewpoint, model_kind);
create index on public.uaf_elements (element_type);

create table public.uaf_relationships (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  source_id         text not null,
  target_id         text not null,
  relationship_type text not null,
  properties        jsonb,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index on public.uaf_relationships (workspace_id);
create index on public.uaf_relationships (source_id);
create index on public.uaf_relationships (target_id);

create table public.workspace_repos (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url          text not null,
  name         text not null,
  status       text not null default 'pending',
  error        text,
  ipfs_cid     text,
  data         jsonb,
  added_by     uuid references auth.users(id) on delete set null default auth.uid(),
  added_at     timestamptz not null default now(),
  analyzed_at  timestamptz
);
create index on public.workspace_repos (workspace_id);

-- Only a masked key is stored here; real keys stay on the machine that added them.
create table public.workspace_api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider     text not null,
  name         text not null,
  masked_key   text not null,
  added_by     uuid references auth.users(id) on delete set null default auth.uid(),
  added_at     timestamptz not null default now()
);
create index on public.workspace_api_keys (workspace_id);

create table public.stored_files (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cid          text not null,
  name         text not null,
  size         bigint not null default 0,
  mime_type    text,
  pinned       boolean not null default false,
  added_by     uuid references auth.users(id) on delete set null default auth.uid(),
  added_at     timestamptz not null default now(),
  unique (cid, workspace_id)
);

create table public.resource_usage (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  flow_id         text,
  flow_name       text,
  type            text not null,
  provider        text,
  tokens_used     int,
  compute_seconds int,
  cost_cents      int,
  user_id         uuid references auth.users(id) on delete set null default auth.uid(),
  "timestamp"     timestamptz not null default now()
);
create index on public.resource_usage (workspace_id, "timestamp" desc);

create table public.whiteboards (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  elements_cid text,
  version      int not null default 1,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.whiteboards (workspace_id);

create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sender_id    uuid references auth.users(id) on delete set null default auth.uid(),
  sender       text not null,
  sender_name  text not null,
  content      text not null,
  "timestamp"  timestamptz not null default now()
);
create index on public.chat_messages (workspace_id, "timestamp" desc);

create table public.workspace_tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null,
  description  text,
  status       text not null default 'todo',
  priority     text not null default 'medium',
  assignee     text,
  bounty       text,
  deadline     text,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.workspace_tasks (workspace_id, status);

-- One row per (workspace, node). node_id is the stable ID the node's inference
-- relay answers to (e.g. node-<hostname> or a wallet address).
create table public.workspace_peers (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  node_id         text not null,
  user_id         uuid not null references auth.users(id) on delete cascade default auth.uid(),
  peer_id         text not null default '',
  addresses       jsonb not null default '[]',
  display_name    text,
  ollama_endpoint text,
  ollama_models   jsonb not null default '[]',
  last_seen       timestamptz not null default now(),
  primary key (workspace_id, node_id)
);

create table public.signaling (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  from_peer_id   text not null,
  target_peer_id text not null,
  type           text not null,
  payload        text not null,
  sender_id      uuid references auth.users(id) on delete set null default auth.uid(),
  "timestamp"    timestamptz not null default now()
);
create index on public.signaling (workspace_id, target_peer_id, "timestamp");
create index on public.signaling ("timestamp");

create table public.compute_jobs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type         text not null check (type in ('wasm','container','native')),
  payload      jsonb not null,
  requirements jsonb,
  status       text not null default 'pending',
  assigned_to  text,
  result       jsonb,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.compute_jobs (workspace_id, status);

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_flows','uaf_elements','uaf_relationships','workspace_repos',
    'workspace_api_keys','stored_files','resource_usage','whiteboards',
    'chat_messages','workspace_tasks','workspace_peers','signaling','compute_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members select" on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy "members insert" on public.%I for insert with check (public.is_member(workspace_id))', t);
    execute format('create policy "members update" on public.%I for update using (public.is_member(workspace_id))', t);
    execute format('create policy "members delete" on public.%I for delete using (public.is_member(workspace_id))', t);
  end loop;

  foreach t in array array['workspace_flows','uaf_elements','whiteboards','workspace_tasks','compute_jobs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
  end loop;
end $$;

-- Senders can only speak as themselves in chat and signaling.
create policy "sender is self" on public.chat_messages as restrictive
  for insert with check (sender_id = auth.uid());
create policy "sender is self" on public.signaling as restrictive
  for insert with check (sender_id = auth.uid());
-- A node row can only be written by the user that owns it.
create policy "own peer row insert" on public.workspace_peers as restrictive
  for insert with check (user_id = auth.uid());
create policy "own peer row update" on public.workspace_peers as restrictive
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own peer row delete" on public.workspace_peers as restrictive
  for delete using (user_id = auth.uid());

-- Atomic compute-job claim (Appwrite version could double-assign).
create or replace function public.claim_compute_job(job uuid, node text) returns public.compute_jobs
language sql security invoker as $$
  update public.compute_jobs
     set status = 'running', assigned_to = node
   where id = job and status = 'pending'
  returning *
$$;

-- ─── On-chain mirror tables ────────────────────────────────────────────────
-- chain_workspace_id is the bytes32 workspace id used by the contracts.

create table public.smart_contracts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  contract_address text not null,
  chain_id         int not null,
  contract_type    text not null,
  abi              jsonb,
  status           text not null default 'active',
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (contract_address, chain_id)
);

create table public.agreements (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       text not null,
  chain_agreement_id text unique,
  document_hash      text not null,
  title              text not null,
  type               text not null,
  issuer_address     varchar(42) not null,
  expires_at         timestamptz,
  required           boolean not null default false,
  created_at         timestamptz not null default now()
);
create index on public.agreements (workspace_id);

create table public.agreement_signatures (
  id             uuid primary key default gen_random_uuid(),
  agreement_id   text not null,
  signer_address varchar(42) not null,
  signed_at      timestamptz not null default now(),
  tx_hash        text,
  unique (agreement_id, signer_address)
);
create index on public.agreement_signatures (signer_address);

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  task_id          text not null unique,
  workspace_id     text not null,
  title            text,
  description      text,
  milestones       jsonb,
  assignee_address varchar(42),
  status           text not null,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.tasks (workspace_id);
create index on public.tasks (assignee_address);
create trigger tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.ip_registrations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null,
  task_id         text not null unique,
  creator_address varchar(42) not null,
  license_type    text not null,
  license_cid     text,
  tx_hash         text,
  created_at      timestamptz not null default now()
);
create index on public.ip_registrations (workspace_id);

do $$
declare
  t text;
begin
  foreach t in array array['smart_contracts','agreements','agreement_signatures','tasks','ip_registrations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "signed-in insert" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "signed-in update" on public.%I for update to authenticated using (true)', t);
  end loop;
end $$;

-- ─── Realtime & housekeeping ───────────────────────────────────────────────

alter publication supabase_realtime add table
  public.chat_messages, public.signaling, public.workspace_peers,
  public.workspace_tasks, public.workspace_flows, public.workspace_members;

-- Signals are ephemeral; drop anything older than 5 minutes (called by nodes,
-- replaces Appwrite cleanupSignals).
create or replace function public.cleanup_signals(ws uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.signaling
   where workspace_id = ws and "timestamp" < now() - interval '5 minutes'
     and public.is_member(ws)
$$;

grant execute on function
  public.join_workspace(text), public.regenerate_invite_code(uuid),
  public.claim_compute_job(uuid, text), public.cleanup_signals(uuid),
  public.is_member(uuid), public.is_admin(uuid)
  to authenticated;
grant execute on function public.profile_by_wallet(text, int) to anon, authenticated;
