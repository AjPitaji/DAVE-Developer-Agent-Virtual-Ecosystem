-- ============================================================================
-- DAVE - Developer Discovery Flow
-- PART 1 of 2: schema and policies (no function bodies)
-- Paste this into the Supabase SQL Editor and run it as a single batch.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. teams.is_public
-- ---------------------------------------------------------------------------
alter table public.teams
  add column if not exists is_public boolean not null default false;

create index if not exists idx_teams_is_public
  on public.teams(is_public)
  where is_public = true;

-- ---------------------------------------------------------------------------
-- 2. team_join_requests
--
-- status is `text` + a CHECK constraint rather than a custom enum, on purpose.
-- The enum version needed a `do $$ ... $$` block to create its type, and
-- Supabase's SQL Editor silently drops those blocks on paste. That left the
-- type missing and every function referencing it failed with:
--     ERROR 42704: type "join_request_status" does not exist
-- With `text` there is no dependency to fail. The accepted literals are
-- identical, so no application code needs to change.
--
-- If you already ran the enum version, the column is still the enum. That is
-- fine: text literals and enum values interoperate, and the functions in
-- PART 2 never name the type. They do cast on every READ (r.status::text) so
-- they work against either column type.
-- ---------------------------------------------------------------------------
create table if not exists public.team_join_requests (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id)    on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending','approved','rejected','cancelled')),
  message     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- The earlier revision added a table-level UNIQUE(team_id, user_id), which
-- would block a dev from re-requesting after a rejection. Replace it with a
-- partial unique index that only applies while a request is pending.
alter table public.team_join_requests
  drop constraint if exists team_join_requests_team_id_user_id_key;

create unique index if not exists uq_tjr_pending
  on public.team_join_requests(team_id, user_id)
  where status = 'pending';

create index if not exists idx_tjr_team_status on public.team_join_requests(team_id, status);
create index if not exists idx_tjr_user_status on public.team_join_requests(user_id, status);
create index if not exists idx_tjr_created_at  on public.team_join_requests(created_at desc);

-- updated_at trigger. set_updated_at() ships with initial_schema.
drop trigger if exists team_join_requests_updated_at on public.team_join_requests;
create trigger team_join_requests_updated_at
  before update on public.team_join_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. CLEANUP: drop the recursive policies from earlier attempts.
--
-- Each of these let one RLS-protected table read another that already read it
-- back, which Postgres rejects with:
--     42P17 infinite recursion detected in policy for relation "X"
-- Their work is now done inside the security-definer functions in PART 2.
-- ---------------------------------------------------------------------------
drop policy if exists tm_select_public_team      on public.team_members;
drop policy if exists projects_select_public_team on public.projects;
drop policy if exists tjr_select_owner            on public.team_join_requests;
drop policy if exists tjr_update_owner            on public.team_join_requests;

drop function if exists private.public_team_ids();
drop function if exists private.team_is_public(uuid);

-- ---------------------------------------------------------------------------
-- 4. Policies. Every one is a FLAT comparison against auth.uid() with no
--    subqueries, which is what keeps this schema recursion-free.
-- ---------------------------------------------------------------------------

-- Public teams are readable by any signed-in user.
drop policy if exists teams_select_public on public.teams;
create policy teams_select_public on public.teams
  for select
  using (is_public = true);

-- A dev can see / create / update only their own join requests. Owners act
-- through public.decide_join_request() rather than a policy, because
-- "is pending" plus "am I an owner of that team" cannot be expressed as a
-- flat comparison without a subquery.
alter table public.team_join_requests enable row level security;

drop policy if exists tjr_select_self on public.team_join_requests;
drop policy if exists tjr_insert_self on public.team_join_requests;
drop policy if exists tjr_update_self on public.team_join_requests;

create policy tjr_select_self on public.team_join_requests
  for select
  using (auth.uid() = user_id);

create policy tjr_insert_self on public.team_join_requests
  for insert
  with check (auth.uid() = user_id);

create policy tjr_update_self on public.team_join_requests
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);