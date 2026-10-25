-- ============================================================================
-- DAVE - Team members gain access to their team's projects
-- Created: 2026-10-06
--
-- THE BUG
--   A developer approved into a team lands in `team_members`, but never in
--   `project_members`. Meanwhile every downstream RLS policy for boards,
--   columns, tasks, labels and comments is gated on:
--
--       project_id in (select private.user_project_ids())
--
--   and that helper reads ONLY from `project_members`:
--
--       select project_id from public.project_members where user_id = auth.uid()
--
--   So opening a project as a developer failed with:
--       new row violates row-level security policy for table "boards"
--
--   Two things conspired:
--     a) the project page falls back to INSERTing a board when the SELECT
--        returns no rows, and that INSERT is also blocked by RLS, so the
--        "board missing" case surfaced as an INSERT violation;
--     b) the dashboard already grants team members visibility of their team's
--        projects (it queries projects by team_id), so the app was internally
--        inconsistent about what "team member" means.
--
-- THE FIX
--   1. Widen private.user_project_ids() so team membership also grants access
--      to that team's projects. This aligns RLS with how the dashboard and
--      discover feed already behave.
--   2. Add a trigger that backfills project_members when someone joins a team,
--      so assignment pickers, owner checks and analytics stay accurate.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Team membership implies access to that team's projects
-- ---------------------------------------------------------------------------
create or replace function private.user_project_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  -- explicit project membership
  select pm.project_id
  from public.project_members pm
  where pm.user_id = auth.uid()
  union
  -- membership of the owning team
  select p.id
  from public.projects p
  where p.team_id in (
    select tm.team_id
    from public.team_members tm
    where tm.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Backfill project_members for anyone added to a team
--
-- SECURITY DEFINER so the insert is not itself blocked by pm_insert_owner,
-- which only lets team/project owners write. The trigger fires as the table
-- owner and therefore bypasses RLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_team_member_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  select p.id, new.user_id, 'dev'
  from public.projects p
  where p.team_id = new.team_id
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_team_member_added on public.team_members;
create trigger on_team_member_added
  after insert on public.team_members
  for each row execute function public.handle_team_member_added();

-- Also cover the UPDATE path, in case a row is ever promoted to owner.
create or replace function public.handle_team_member_role_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  select p.id, new.user_id,
         case when new.role = 'owner' then 'owner'::project_role
              else 'dev'::project_role end
  from public.projects p
  where p.team_id = new.team_id
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_team_member_role_changed on public.team_members;
create trigger on_team_member_role_changed
  after update of role on public.team_members
  for each row execute function public.handle_team_member_role_changed();

-- ---------------------------------------------------------------------------
-- 3. One-off backfill for memberships created before this migration
-- ---------------------------------------------------------------------------
insert into public.project_members (project_id, user_id, role)
select p.id, tm.user_id,
       case when tm.role = 'owner' then 'owner' else 'dev' end
from public.team_members tm
join public.projects p on p.team_id = tm.team_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. New projects created after this point should include every team member
--
-- handle_new_project() only inserts the creator. Widen it so joining a team
-- and then creating an Epic does not silently produce a project whose other
-- members cannot see the board.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;

  insert into public.project_members (project_id, user_id, role)
  select new.id, tm.user_id,
         case when tm.role = 'owner' then 'owner' else 'dev' end
  from public.team_members tm
  where tm.team_id = new.team_id
  on conflict do nothing;

  return new;
end;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Projects a given dev should now be able to reach.
-- select private.user_project_ids();

-- Backfill result: expect one row per (project, team member) pair.
-- select p.name as project, t.name as team, count(*) as members
-- from public.project_members pm
-- join public.projects p on p.id = pm.project_id
-- join public.teams    t on t.id = p.team_id
-- group by 1, 2
-- order by 1;

-- The two triggers that now keep this in sync.
-- select tgname from pg_trigger
--  where tgrelid = 'public.team_members'::regclass and not tgisinternal;
-- ============================================================================