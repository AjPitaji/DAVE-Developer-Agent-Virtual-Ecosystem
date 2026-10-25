-- ============================================================================
-- DAVE — Fix Developer Project Access
-- Run this in Supabase SQL Editor if developers can't open projects
-- ============================================================================

-- 1. Ensure user_project_ids() includes team membership
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

-- 2. Backfill project_members for ALL current team members (covers any missed by trigger)
insert into public.project_members (project_id, user_id, role)
select p.id, tm.user_id,
       case when tm.role = 'owner' then 'owner'::project_role else 'dev'::project_role end
from public.team_members tm
join public.projects p on p.team_id = tm.team_id
on conflict do nothing;

-- 3. Verify the fix - should show projects the current user can now reach
select private.user_project_ids();

-- 4. Check team members now have project_members entries
select p.name as project, t.name as team, tm.user_id, pm.role::text as role
from public.project_members pm
join public.projects p on p.id = pm.project_id
join public.teams t on t.id = p.team_id
join public.team_members tm on tm.team_id = t.id and tm.user_id = pm.user_id
order by p.name, tm.user_id;