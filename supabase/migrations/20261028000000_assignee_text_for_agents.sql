-- Make tasks.assignee_id a text column so AI agent ids (non-uuid) can be
-- stored there too. Drops the FK to profiles so agents (which are not
-- auth users / profiles) can be recorded as assignees instead of null.

-- 1. Drop dependent policies first (column type change).
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

-- 2. Drop the FK constraint to profiles (if still present) BEFORE altering type.
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
  if c is not null then
    execute format('alter table public.tasks drop constraint %I', c);
  end if;
end $$;

-- 3. Alter column type.
alter table public.tasks
  alter column assignee_id type text using assignee_id::text;

-- 4. Ensure helper exists (idempotent), then recreate with text param.
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

create or replace function private.user_can_read_task(p_column_id uuid, p_assignee_id text, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_assignee_id = auth.uid()::text
    or p_created_by = auth.uid()
    or private.user_owns_column_project(p_column_id);
$$;

create or replace function private.user_can_write_task(p_column_id uuid, p_assignee_id text, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_assignee_id = auth.uid()::text
    or p_created_by = auth.uid()
    or private.user_owns_column_project(p_column_id);
$$;

-- 5. Recreate policies.
create policy tasks_select on public.tasks
  for select
  using (private.user_can_read_task(column_id, assignee_id, created_by));

create policy tasks_update on public.tasks
  for update
  using (private.user_can_write_task(column_id, assignee_id, created_by))
  with check (private.user_can_write_task(column_id, assignee_id, created_by));

create policy tasks_delete on public.tasks
  for delete
  using (private.user_can_write_task(column_id, assignee_id, created_by));
