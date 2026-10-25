-- ============================================================================
-- DAVE - Project planning / start flow
-- Created: 2026-10-10
--
-- WHY THIS EXISTS
--   Today a project lands in `status = 'active'` the moment it's created, and
--   the owner can declare a GitHub repo but cannot enforce a deadline or
--   gate activation on real task assignment. We want:
--
--     1. New projects start in `status = 'draft'` (planning).
--     2. The owner can set / change a deadline.
--     3. The owner presses "Start Project" -> status flips to 'active' and
--        `started_at` is stamped. The start is blocked when deadline is null.
--     4. While in draft, only the owner can create or move tasks (handled in
--        the app UI; RLS keeps the project visible to team members so they
--        can see what they'll be working on).
--     5. Existing active projects are not touched.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the project_status enum with 'draft'
-- ---------------------------------------------------------------------------
do $$ begin
  alter type public.project_status add value if not exists 'draft';
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. New columns on projects
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists deadline    timestamptz,
  add column if not exists started_at  timestamptz;

-- Helpful index for the dashboard "show projects past their deadline" view
-- and for filtering by status (owner view).
create index if not exists idx_projects_status    on public.projects(status);
create index if not exists idx_projects_deadline  on public.projects(deadline);

-- ---------------------------------------------------------------------------
-- 3. Helper: is a given project eligible to start?
--    Returns a row with booleans so the client can render the readiness
--    banner without doing four round trips.
-- ---------------------------------------------------------------------------
create or replace function public.project_start_readiness(p_project_id uuid)
returns table (
  has_deadline      boolean,
  deadline_passed   boolean,
  total_tasks       bigint,
  unassigned_tasks  bigint,
  members_total     bigint,
  members_with_task bigint,
  is_owner          boolean,
  can_start         boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  with proj as (
    select p.deadline, p.owner_id
    from public.projects p
    where p.id = p_project_id
  ),
  counts as (
    select
      count(*)::bigint                                                  as total_tasks,
      count(*) filter (where t.assignee_id is null)::bigint             as unassigned_tasks
    from public.tasks t
    join public.columns c on c.id = t.column_id
    join public.boards   b on b.id = c.board_id
    where b.project_id = p_project_id
  ),
  members as (
    -- Everyone in the team is part of the project roster by virtue of the
    -- `handle_team_member_added` trigger + `handle_new_project` trigger that
    -- already maintain project_members for us.
    select
      count(*)::bigint                                                  as members_total,
      count(distinct t.assignee_id)::bigint                             as members_with_task
    from public.project_members pm
    left join public.tasks t
      on t.column_id in (select id from public.columns
                          where board_id in (select id from public.boards
                                              where project_id = p_project_id))
     and t.assignee_id = pm.user_id
    where pm.project_id = p_project_id
  )
  select
    (proj.deadline is not null)                                                                as has_deadline,
    case when proj.deadline is not null and proj.deadline < now() then true else false end      as deadline_passed,
    coalesce(counts.total_tasks, 0)                                                            as total_tasks,
    coalesce(counts.unassigned_tasks, 0)                                                       as unassigned_tasks,
    coalesce(members.members_total, 0)                                                         as members_total,
    coalesce(members.members_with_task, 0)                                                     as members_with_task,
    (proj.owner_id = auth.uid())                                                               as is_owner,
    (proj.owner_id = auth.uid()
     and proj.deadline is not null
     and counts.total_tasks > 0
     and counts.unassigned_tasks = 0)                                                         as can_start
  from proj
  cross join counts
  cross join members;
$$;

revoke all on function public.project_start_readiness(uuid) from public;
grant execute on function public.project_start_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. start_project RPC
--    Atomic: only the owner, only if a deadline is set, only if the project
--    is still in draft, only if every task has an assignee. We deliberately
--    do NOT require every member to have a task (per design: "owner can
--    start even if not all devs have tasks").
-- ---------------------------------------------------------------------------
create or replace function public.start_project(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_deadline timestamptz;
  v_status public.project_status;
  v_unassigned bigint;
  v_result public.projects;
begin
  select p.owner_id, p.deadline, p.status
    into v_owner, v_deadline, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_owner is null then
    raise exception 'Project not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Only the project owner can start the project';
  end if;
  if v_status <> 'draft' then
    raise exception 'Project is not in draft (current status: %)', v_status;
  end if;
  if v_deadline is null then
    raise exception 'Cannot start a project without a deadline';
  end if;

  select count(*) into v_unassigned
  from public.tasks t
  join public.columns c on c.id = t.column_id
  join public.boards   b on b.id = c.board_id
  where b.project_id = p_project_id
    and t.assignee_id is null;

  if v_unassigned > 0 then
    raise exception 'Cannot start: % task(s) are still unassigned', v_unassigned;
  end if;

  update public.projects
  set status = 'active',
      started_at = now(),
      updated_at = now()
  where id = p_project_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.start_project(uuid) from public;
grant execute on function public.start_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. set_project_deadline RPC
--    Lets the owner (or an admin in future) set / change / clear the deadline.
--    The trigger that keeps updated_at fresh handles bump.
-- ---------------------------------------------------------------------------
create or replace function public.set_project_deadline(
  p_project_id uuid,
  p_deadline   timestamptz
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status public.project_status;
  v_result public.projects;
begin
  select p.owner_id, p.status
    into v_owner, v_status
  from public.projects p
  where p.id = p_project_id
  for update;

  if v_owner is null then
    raise exception 'Project not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Only the project owner can change the deadline';
  end if;
  if v_status in ('archived', 'on_hold') then
    raise exception 'Cannot change deadline on a % project', v_status;
  end if;

  update public.projects
  set deadline = p_deadline,
      updated_at = now()
  where id = p_project_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.set_project_deadline(uuid, timestamptz) from public;
grant execute on function public.set_project_deadline(uuid, timestamptz) to authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
--
-- After running this migration:
--
--   1. The enum now contains 'draft' alongside 'active', 'archived', 'on_hold'.
--        select unnest(enum_range(NULL::public.project_status));
--
--   2. New projects should be created in draft (the app will be updated to
--      do so). Old projects are untouched.
--        select id, name, status, deadline, started_at
--        from public.projects
--        order by created_at desc
--        limit 10;
--
--   3. The owner can call start_project() only when every task is assigned
--      and a deadline is set.
--        select * from public.project_start_readiness('<project_id>');
--        select * from public.start_project('<project_id>');
-- ============================================================================
