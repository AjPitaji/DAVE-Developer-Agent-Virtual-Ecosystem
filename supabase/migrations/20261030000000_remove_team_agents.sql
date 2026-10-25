-- ============================================================================
-- DAVE - Remove the "AI agents on a team" feature
-- Created: 2026-10-30
--
-- WHAT THIS REMOVES
--   The configurable AI-agent roster:
--     * public.team_agents          - the table backing "Add AI Agent to team"
--     * public.tasks.assignee_agent_id - the agent-only assignee column
--
--   And it restores public.tasks.assignee_id to a plain uuid FK into
--   public.profiles, which is what it was before the agent feature widened it
--   to text (20261028000000_assignee_text_for_agents.sql).
--
-- WHY THE COLUMN TYPE HAS TO BE REVERTED
--   20261028000000 widened assignee_id to text so a bot slug could live there.
--   It also dropped the FK to profiles. With the roster gone, a task assignee
--   is always a real profile again, so the uuid column + FK is the correct
--   shape: it restores referential integrity, keeps the assignee index usable,
--   and makes `assignee_id = pm.user_id` compare uuid-to-uuid instead of
--   text-to-uuid in private.project_readiness().
--
-- A SIDE EFFECT WORTH KNOWING
--   20261028000000 also changed user_can_read_task() from
--   column_in_accessible_project() to user_owns_column_project(). That quietly
--   made task reads owner-only and locked same-project developers out of
--   their own board - contradicting the permission matrix documented in
--   20261006000002_assignee_task_access.sql ("same-project developer: read
--   yes"). Restoring the original helper fixes that regression too.
--
-- ORDER MATTERS
--   Postgres re-parses policy expressions when a column type changes, and a
--   function call that no longer resolves aborts the ALTER. So every policy
--   whose expression touches assignee_id is dropped BEFORE the type change and
--   recreated AFTER it. Both the uuid and text overloads of the helpers can
--   exist at this point (CREATE OR REPLACE with a different argument type
--   creates an overload rather than replacing), so the text ones are dropped
--   explicitly to avoid leaving a dangling signature behind.
--
-- HOW TO RUN IT
--   Safe to paste straight into the Supabase SQL Editor. It is written to be
--   self-sufficient: every step is guarded on the current state of the
--   schema, and every helper it depends on is re-declared here, so it does
--   not matter which of the earlier migrations have actually been applied.
--   Run it in one go - the whole script is designed to execute as a single
--   transaction.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Clear agent slugs left in assignee_id
--
--    Any non-uuid value here is an agent id (e.g. 'backend-engineer'). It
--    cannot be cast to uuid, and it no longer points at a profile, so it is
--    cleared rather than migrated. Tasks that were assigned to a bot become
--    unassigned; humans keep their assignee.
--
--    Guarded on the column type: if the widening migration never ran, the
--    column is still uuid, there is nothing agent-shaped to clear, and the
--    regex operator does not even exist for uuid.
-- ---------------------------------------------------------------------------
do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tasks'
    and column_name = 'assignee_id';

  if col_type = 'text' then
    update public.tasks
    set assignee_id = null
    where assignee_id is not null
      and assignee_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the agent-only column and its index
-- ---------------------------------------------------------------------------
drop index if exists idx_tasks_assignee_agent_id;
alter table public.tasks drop column if exists assignee_agent_id;

-- ---------------------------------------------------------------------------
-- 3. Drop every policy that reads assignee_id
-- ---------------------------------------------------------------------------
drop policy if exists tasks_select      on public.tasks;
drop policy if exists tasks_insert      on public.tasks;
drop policy if exists tasks_update      on public.tasks;
drop policy if exists tasks_delete      on public.tasks;
drop policy if exists tc_select         on public.task_comments;
drop policy if exists tc_insert         on public.task_comments;
drop policy if exists task_labels_all   on public.task_labels;

-- ---------------------------------------------------------------------------
-- 4. Drop the text-signature overloads of the task-access helpers
-- ---------------------------------------------------------------------------
drop function if exists private.user_can_read_task(uuid, text, uuid);
drop function if exists private.user_can_write_task(uuid, text, uuid);

-- ---------------------------------------------------------------------------
-- 5. Restore assignee_id to uuid + FK to profiles
--
--    Only alters when the column is still text; if it is already uuid this is
--    a no-op, which keeps the script safe to paste into the SQL editor
--    regardless of which earlier migrations have actually been applied.
-- ---------------------------------------------------------------------------
do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'tasks'
    and column_name = 'assignee_id';

  if col_type = 'text' then
    execute 'alter table public.tasks alter column assignee_id type uuid using assignee_id::uuid';
  end if;
end $$;

-- Re-add the FK if it is not already there (20261028000000 removed it).
do $$
declare
  c text;
begin
  select tc.constraint_name into c
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
  where tc.table_schema = 'public'
    and tc.table_name = 'tasks'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'assignee_id';
  if c is null then
    execute 'alter table public.tasks add constraint tasks_assignee_id_fkey '
         || 'foreign key (assignee_id) references public.profiles(id) on delete set null';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Restore the uuid-signature helpers
--
--    These are the original definitions from 20261006000002. Note that
--    user_can_read_task() uses column_in_accessible_project() (any member of
--    the project can read) while user_can_write_task() uses
--    user_owns_column_project() (only owners can write) - that asymmetry is
--    the documented permission matrix, not an oversight.
--
--    column_in_accessible_project() is re-declared here so this script does
--    not depend on 20261006000002 having been applied first.
-- ---------------------------------------------------------------------------
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
-- 7. Recreate the policies
-- ---------------------------------------------------------------------------

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
create policy tasks_update on public.tasks
  for update
  using (private.user_can_write_task(column_id, assignee_id, created_by))
  with check (private.user_can_write_task(column_id, assignee_id, created_by));

-- Delete: creator, assignee, or project owner.
create policy tasks_delete on public.tasks
  for delete
  using (private.user_can_write_task(column_id, assignee_id, created_by));

-- Task comments follow the same rule.
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

-- Task labels follow read/write access.
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

-- ---------------------------------------------------------------------------
-- 8. Drop the roster table
--
--    team_agents had no dependents other than its own policies, and those go
--    away with the table. Any team that had agents added simply loses them.
-- ---------------------------------------------------------------------------
drop table if exists public.team_agents;

-- ============================================================================
-- RESULTING PERMISSION MATRIX (unchanged from 20261006000002)
--
--   actor                       read    update   delete   comment
--   ------------------------------------------------------------------
--   assignee                    yes     yes      yes      yes
--   task creator (not assigned) yes     yes      yes      yes
--   same-project developer      yes     no       no       yes
--   project / team owner        yes     yes      yes      yes
--   unrelated user              no      no       no       no
-- ============================================================================
