-- One IPFS private-network key per workspace, shared by all members. Before
-- this, each machine generated its own key locally, so members never ended up
-- on the same private swarm.
alter table public.workspaces
  add column ipfs_swarm_key text not null default encode(gen_random_bytes(32), 'hex');

-- Lets PostgREST embed a member's profile (display name) in membership queries.
-- Every auth user gets a profile row on creation, so this always resolves.
alter table public.workspace_members
  add constraint workspace_members_profile_fkey
  foreign key (user_id) references public.user_profiles(user_id) on delete cascade;
