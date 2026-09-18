-- Bridge on-chain workspaces (WorkspaceRegistry on Sepolia) to Postgres.
--
-- On-chain workspaces stay the source of truth for who is a member. Each one
-- gets a linked Postgres workspace (chain_workspace_id) that holds its chat,
-- tasks, peers, etc. Rows and memberships for bridged workspaces are written
-- only by the `chain-bridge` edge function (service role) after it has checked
-- the contract, using the caller's signature-verified wallet.

alter table public.workspaces
  add column chain_workspace_id text unique
    check (chain_workspace_id is null or chain_workspace_id ~ '^0x[0-9a-f]{64}$');

-- A bridged workspace's on-chain owner may not have an OtherThing account yet.
alter table public.workspaces alter column owner_id drop not null;

create or replace function public.handle_new_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;

-- Users can't create bridged workspaces themselves (only the edge function can).
drop policy "users create own workspace" on public.workspaces;
create policy "users create own workspace" on public.workspaces
  for insert with check (owner_id = auth.uid() and chain_workspace_id is null);

-- Invite codes don't apply to bridged workspaces: joining happens on-chain.
create or replace function public.join_workspace(code text) returns public.workspaces
language plpgsql security definer set search_path = public as $$
declare
  ws public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into ws from public.workspaces
   where invite_code = lower(trim(code)) and chain_workspace_id is null;
  if not found then
    raise exception 'Invalid invite code';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, auth.uid(), 'member')
  on conflict do nothing;
  return ws;
end $$;

-- ─── Wallets can only be set by the edge function ──────────────────────────
-- Membership of bridged workspaces is granted from the linked wallet, so a user
-- must not be able to write an arbitrary wallet_address onto their profile.

revoke insert, update on public.user_profiles from anon, authenticated;
grant insert (user_id, display_name, avatar, bio) on public.user_profiles to authenticated;
grant update (display_name, avatar, bio) on public.user_profiles to authenticated;

-- One wallet belongs to at most one account.
create unique index user_profiles_wallet_unique
  on public.user_profiles (lower(wallet_address))
  where wallet_address is not null;
