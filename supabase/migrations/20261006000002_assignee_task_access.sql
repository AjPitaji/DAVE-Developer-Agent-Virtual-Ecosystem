-- ============================================================================
-- DAVE - Assignee-level task access
-- Created: 2026-10-06
--
-- THE GAP
--   Every task policy was gated purely on project membership:
--       tasks_select  -> column's project in private.user_project_ids()
--       tasks_update  -> column's project in private.user_project_ids()
--
--   Two consequences, both wrong for a developer:
--
--   1. A developer assigned a task could not SEE it. The dashboard's "My
--      Assigned Issues" panel queries tasks by assignee_id, but RLS filtered
--      those rows out, so the panel silently rendered empty.
--
--   2. Conversely, tasks_update was too PERMISSIVE for anyone who did have
--      project access: any member could rewrite any other member's task,
--      including reassigning it away from them.
--
-- THE FIX
--   tasks   : a developer can always read a task assigned to them or created
--             by them; they can only UPDATE a task assigned to them. Project
--             and team owners retain full control.
--   comments: a developer can read and write comments on a task they are
--             assigned to, without needing the whole board.
--
--   All cross-table checks go through SECURITY DEFINER helpers. Reading
--   columns/boards/projects directly from a policy would chain RLS
--   dependencies and can trip 42P17 (see 20261005000001 for that lesson).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Is this column part of a project the caller can reach?
create or replace function private.column_in_accessible_project(p_column_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.columns c
    join public.boards b on b.id = c.board_id
    where c.id = p_column_id
      and b.project_id in (select private.user_project_ids())
  );
$$;

-- Does the caller own this column's project, either directly, as project
-- owner, or as an owner of the owning team?
create or replace function private.user_owns_column_project(p_column_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.columns c
    join public.boards   b on b.id = c.board_id
    join public.projects p on p.id = b.project_id
    where c.id = p_column_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
            and pm.role = 'owner'
        )
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = p.team_id
            and tm.user_id = auth.uid()
            and tm.role = 'owner'
        )
      )
  );
$$;

-- Can the caller reach this task at all (project access, or it is theirs)?
create or replace function private.user_can_read_task(p_column_id uuid, p_assignee_id uuid, p_created_by uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    p_assignee_id = auth.uid()
    or p_created_by = auth.uid()
    or private.column_in_accessible_project(p_column_id);
$$;

-- Can the caller change this task? Owners manage anything; everyone else
-- only manages what is assigned to them.
create or replace function private.user_can_write_task(p_column_id uuid, p_assignee_id uuid, p_created_by uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    p_assignee_id = auth.uid()
    or p_created_by = auth.uid()
    or private.user_owns_column_project(p_column_id);
$$;

-- ---------------------------------------------------------------------------
-- 2. Task policies
--
-- RENAME the column on every UPDATE path rather than only gating the write:
-- a developer dragging their own card between columns is the core
-- interaction, and it must survive losing team membership.
-- ---------------------------------------------------------------------------

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

-- Read: yours, or anything on a board you can reach.
create policy tasks_select on public.tasks
  for select
  using (private.user_can_read_task(column_id, assignee_id, created_by));

-- Create: always your own work, on a board you can reach.
create policy tasks_insert on public.tasks
  for insert
  with check (
    created_by = auth.uid()
    and private.column_in_accessible_project(column_id)
  );

-- Move / edit: your own task, or anything if you own the project.
-- The same rule is repeated in WITH CHECK so a developer cannot escalate by
-- reassigning someone else's task to themselves mid-update.
create policy tasks_update on public.tasks
  for update
  using (private.user_can_write_task(column_id, assignee_id, created_by))
  with check (private.user_can_write_task(column_id, assignee_id, created_by));

-- Delete: creator, assignee, or project owner.
create policy tasks_delete on public.tasks
  for delete
  using (private.user_can_write_task(column_id, assignee_id, created_by));

-- ---------------------------------------------------------------------------
-- 3. Task comments follow the same rule
-- ---------------------------------------------------------------------------

drop policy if exists tc_select      on public.task_comments;
drop policy if exists tc_insert      on public.task_comments;
drop policy if exists tc_update_own  on public.task_comments;
drop policy if exists tc_delete_own  on public.task_comments;

create policy tc_select on public.task_comments
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and private.user_can_read_task(t.column_id, t.assignee_id, t.created_by)
    )
  );

create policy tc_insert on public.task_comments
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and private.user_can_read_task(t.column_id, t.assignee_id, t.created_by)
    )
  );

create policy tc_update_own on public.task_comments
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy tc_delete_own on public.task_comments
  for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Task labels follow read access, so a developer can label their own task
-- ---------------------------------------------------------------------------

drop policy if exists task_labels_all on public.task_labels;

create policy task_labels_all on public.task_labels
  for all
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_labels.task_id
        and private.user_can_read_task(t.column_id, t.assignee_id, t.created_by)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_labels.task_id
        and private.user_can_write_task(t.column_id, t.assignee_id, t.created_by)
    )
  );

-- ============================================================================
-- RESULTING PERMISSION MATRIX
--
--   actor                       read    update   delete   comment
--   ------------------------------------------------------------------
--   assignee                    yes     yes      yes      yes
--   task creator (not assigned) yes     yes      yes      yes
--   same-project developer      yes     no       no       yes
--   project / team owner        yes     yes      yes      yes
--   unrelated user              no      no       no       no
--
--   Note the third row is the behavioural change: previously any project
--   member could rewrite anyone's task.
-- ============================================================================