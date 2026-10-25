-- ============================================================================
-- DAVE — Initial Schema Migration
-- Created: 2026-10-03
--
-- Tables: profiles, teams, team_members, projects, project_members,
--         boards, columns, tasks, labels, task_labels, task_comments,
--         workflows, workflow_stages, approval_requests, notifications
--
-- Roles: simplified to owner | dev (no admin/member/viewer tiers)
-- Capacity: projects.max_open_tasks (default 10) — remaining computed via fn
-- RLS: enabled everywhere, security-definer helpers to avoid recursion
--
-- IMPORTANT — file order is mandatory:
--   extensions -> enums -> tables -> helper functions -> triggers ->
--   capacity helpers -> rls -> grants -> realtime
-- SQL-language functions validate table references at CREATE time, so
-- helpers that read tables must come AFTER those tables exist.
--
-- Run via: Supabase SQL Editor, or `supabase db push` after `supabase link`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type team_role     as enum ('owner', 'dev');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_role  as enum ('owner', 'dev');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('active', 'archived', 'on_hold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type board_type    as enum ('kanban', 'list');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status   as enum ('todo', 'in_progress', 'done', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum ('pending', 'approved', 'rejected', 'changes_requested');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_role as enum ('owner', 'dev');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'task_assigned',
    'comment_added',
    'approval_requested',
    'approval_completed'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Generic updated_at trigger (no table deps, safe to define early)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables (in dependency order: parents before children)
-- ---------------------------------------------------------------------------

-- profiles (extends auth.users) ------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- teams ------------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_teams_owner_id on public.teams(owner_id);

drop trigger if exists teams_updated_at on public.teams;
create trigger teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- team_members (owner | dev) ----------------------------------------------------
create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      team_role not null default 'dev',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
-- Critical: separate index on user_id (composite PK only indexes first column)
create index if not exists idx_team_members_user_id on public.team_members(user_id);

-- projects (with capacity) ----------------------------------------------------
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  name            text not null,
  description     text,
  owner_id        uuid not null references public.profiles(id) on delete restrict,
  status          project_status not null default 'active',
  max_open_tasks  integer not null default 10 check (max_open_tasks >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_projects_team_id  on public.projects(team_id);
create index if not exists idx_projects_owner_id on public.projects(owner_id);

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- project_members (owner | dev) ------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       project_role not null default 'dev',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_members_user_id on public.project_members(user_id);

-- boards -----------------------------------------------------------------------
create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  type       board_type not null default 'kanban',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_boards_project_id on public.boards(project_id);

drop trigger if exists boards_updated_at on public.boards;
create trigger boards_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

-- columns ----------------------------------------------------------------------
create table if not exists public.columns (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null,
  position   integer not null,
  color      text default '#94a3b8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_columns_board_position
  on public.columns(board_id, position);

drop trigger if exists columns_updated_at on public.columns;
create trigger columns_updated_at
  before update on public.columns
  for each row execute function public.set_updated_at();

-- tasks ------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  column_id   uuid not null references public.columns(id) on delete cascade,
  title       text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  priority    task_priority not null default 'medium',
  due_date    timestamptz,
  position    integer not null,
  status      task_status not null default 'todo',
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tasks_column_position on public.tasks(column_id, position);
create index if not exists idx_tasks_assignee_id     on public.tasks(assignee_id);

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- labels -----------------------------------------------------------------------
create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  color      text not null default '#94a3b8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_labels_project_id on public.labels(project_id);

drop trigger if exists labels_updated_at on public.labels;
create trigger labels_updated_at
  before update on public.labels
  for each row execute function public.set_updated_at();

-- task_labels (m2m) ------------------------------------------------------------
create table if not exists public.task_labels (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (task_id, label_id)
);
create index if not exists idx_task_labels_label_id on public.task_labels(label_id);

-- task_comments ----------------------------------------------------------------
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_task_comments_task_created
  on public.task_comments(task_id, created_at desc);

drop trigger if exists task_comments_updated_at on public.task_comments;
create trigger task_comments_updated_at
  before update on public.task_comments
  for each row execute function public.set_updated_at();

-- workflows --------------------------------------------------------------------
create table if not exists public.workflows (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_workflows_project_id on public.workflows(project_id);

drop trigger if exists workflows_updated_at on public.workflows;
create trigger workflows_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

-- workflow_stages --------------------------------------------------------------
create table if not exists public.workflow_stages (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete cascade,
  name          text not null,
  position      integer not null,
  approver_role approval_role not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists idx_workflow_stages_workflow_position
  on public.workflow_stages(workflow_id, position);

drop trigger if exists workflow_stages_updated_at on public.workflow_stages;
create trigger workflow_stages_updated_at
  before update on public.workflow_stages
  for each row execute function public.set_updated_at();

-- approval_requests ------------------------------------------------------------
create table if not exists public.approval_requests (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  workflow_stage_id uuid not null references public.workflow_stages(id) on delete cascade,
  reviewer_id       uuid references public.profiles(id) on delete set null,
  status            approval_status not null default 'pending',
  comment           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_approval_requests_task_stage
  on public.approval_requests(task_id, workflow_stage_id);
create index if not exists idx_approval_requests_reviewer
  on public.approval_requests(reviewer_id);

drop trigger if exists approval_requests_updated_at on public.approval_requests;
create trigger approval_requests_updated_at
  before update on public.approval_requests
  for each row execute function public.set_updated_at();

-- notifications ----------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       notification_type not null,
  title      text not null,
  message    text not null,
  read       boolean not null default false,
  link       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_read_created
  on public.notifications(user_id, read, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Backfill profiles for existing auth users
-- ---------------------------------------------------------------------------

-- Create profiles for any auth.users who don't have one yet
-- This fixes the foreign key constraint error when creating teams/projects
insert into public.profiles (id, name)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1),
    'User'
  ) as name
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ---------------------------------------------------------------------------
-- 5. Helper schema + security-definer functions
--    (Defined AFTER tables — SQL functions validate table refs at CREATE time)
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- Team IDs the current user belongs to
create or replace function private.user_team_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

-- Team IDs where the current user is an owner
create or replace function private.user_owned_team_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select team_id from public.team_members where user_id = auth.uid() and role = 'owner';
$$;

-- Project IDs the current user has access to
create or replace function private.user_project_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select project_id from public.project_members where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

-- 5a. Auto-create profile on signup ------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5b. Auto-add team creator as owner member ---------------------------------
create or replace function public.handle_new_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_team_created on public.teams;
create trigger on_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- 5c. Auto-add project creator as owner member ------------------------------
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- 5d. Auto-create default columns on board creation --------------------------
create or replace function public.handle_new_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'kanban' then
    insert into public.columns (board_id, name, position, color) values
      (new.id, 'To Do',       0, '#94a3b8'),
      (new.id, 'In Progress', 1, '#3b82f6'),
      (new.id, 'Done',        2, '#22c55e');
  else
    insert into public.columns (board_id, name, position, color) values
      (new.id, 'Open',   0, '#94a3b8'),
      (new.id, 'Closed', 1, '#22c55e');
  end if;
  return new;
end;
$$;

drop trigger if exists on_board_created on public.boards;
create trigger on_board_created
  after insert on public.boards
  for each row execute function public.handle_new_board();

-- ---------------------------------------------------------------------------
-- 6. Capacity helpers (remaining = max_open_tasks - open tasks)
-- ---------------------------------------------------------------------------

-- Count of tasks with status != 'done' for a project
create or replace function public.project_open_task_count(p_project_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::integer
  from public.tasks t
  join public.columns c on c.id = t.column_id
  join public.boards   b on b.id = c.board_id
  where b.project_id = p_project_id
    and t.status <> 'done';
$$;

-- Remaining capacity for a project (max - open count). Negative means over.
create or replace function public.project_remaining_capacity(p_project_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select p.max_open_tasks - public.project_open_task_count(p_project_id)
  from public.projects p
  where p.id = p_project_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.projects            enable row level security;
alter table public.project_members     enable row level security;
alter table public.boards              enable row level security;
alter table public.columns             enable row level security;
alter table public.tasks               enable row level security;
alter table public.labels              enable row level security;
alter table public.task_labels         enable row level security;
alter table public.task_comments       enable row level security;
alter table public.workflows           enable row level security;
alter table public.workflow_stages     enable row level security;
alter table public.approval_requests   enable row level security;
alter table public.notifications       enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_select_all  on public.profiles;
drop policy if exists profiles_insert_own  on public.profiles;
drop policy if exists profiles_update_own  on public.profiles;

create policy profiles_select_all on public.profiles
  for select using (true);

create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- teams ----------------------------------------------------------------------
drop policy if exists teams_select_members     on public.teams;
drop policy if exists teams_insert_authenticated on public.teams;
drop policy if exists teams_update_owners      on public.teams;
drop policy if exists teams_delete_owner       on public.teams;

create policy teams_select_members on public.teams
  for select using (
    owner_id = auth.uid()
    or id in (select private.user_team_ids())
  );

create policy teams_insert_authenticated on public.teams
  for insert with check (
    owner_id = auth.uid()
    and auth.uid() is not null
  );

create policy teams_update_owners on public.teams
  for update using (
    owner_id = auth.uid()
    or id in (select private.user_owned_team_ids())
  );

create policy teams_delete_owner on public.teams
  for delete using (owner_id = auth.uid());

-- team_members ---------------------------------------------------------------
drop policy if exists tm_select             on public.team_members;
drop policy if exists tm_insert_owner       on public.team_members;
drop policy if exists tm_update_owner       on public.team_members;
drop policy if exists tm_delete_owner_or_self on public.team_members;

create policy tm_select on public.team_members
  for select using (
    user_id = auth.uid()
    or team_id in (select private.user_team_ids())
  );

create policy tm_insert_owner on public.team_members
  for insert with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );

create policy tm_update_owner on public.team_members
  for update using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );

create policy tm_delete_owner_or_self on public.team_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );

-- projects -------------------------------------------------------------------
drop policy if exists projects_select_team_members on public.projects;
drop policy if exists projects_insert_team_owners on public.projects;
drop policy if exists projects_update_owners      on public.projects;
drop policy if exists projects_delete_owner       on public.projects;

create policy projects_select_team_members on public.projects
  for select using (
    owner_id = auth.uid()
    or team_id in (select private.user_team_ids())
  );

create policy projects_insert_team_owners on public.projects
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.team_members tm
      where tm.team_id = projects.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'owner'
    )
  );

create policy projects_update_owners on public.projects
  for update using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = projects.id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

create policy projects_delete_owner on public.projects
  for delete using (owner_id = auth.uid());

-- project_members ------------------------------------------------------------
drop policy if exists pm_select       on public.project_members;
drop policy if exists pm_insert_owner on public.project_members;
drop policy if exists pm_update_owner on public.project_members;
drop policy if exists pm_delete_owner_or_self on public.project_members;

create policy pm_select on public.project_members
  for select using (
    user_id = auth.uid()
    or project_id in (select private.user_project_ids())
  );

create policy pm_insert_owner on public.project_members
  for insert with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

create policy pm_update_owner on public.project_members
  for update using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

create policy pm_delete_owner_or_self on public.project_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

-- boards ---------------------------------------------------------------------
drop policy if exists boards_select_p on public.boards;
drop policy if exists boards_insert_p on public.boards;
drop policy if exists boards_update_p on public.boards;
drop policy if exists boards_delete_p on public.boards;

create policy boards_select_p on public.boards
  for select using (project_id in (select private.user_project_ids()));

create policy boards_insert_p on public.boards
  for insert with check (project_id in (select private.user_project_ids()));

create policy boards_update_p on public.boards
  for update using (project_id in (select private.user_project_ids()));

create policy boards_delete_p on public.boards
  for delete using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = boards.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

-- columns --------------------------------------------------------------------
drop policy if exists columns_select on public.columns;
drop policy if exists columns_write  on public.columns;

create policy columns_select on public.columns
  for select using (
    board_id in (
      select b.id from public.boards b
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy columns_write on public.columns
  for all using (
    board_id in (
      select b.id from public.boards b
      where b.project_id in (select private.user_project_ids())
    )
  )
  with check (
    board_id in (
      select b.id from public.boards b
      where b.project_id in (select private.user_project_ids())
    )
  );

-- tasks ----------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

create policy tasks_select on public.tasks
  for select using (
    column_id in (
      select c.id from public.columns c
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy tasks_insert on public.tasks
  for insert with check (
    created_by = auth.uid()
    and column_id in (
      select c.id from public.columns c
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy tasks_update on public.tasks
  for update using (
    column_id in (
      select c.id from public.columns c
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy tasks_delete on public.tasks
  for delete using (
    created_by = auth.uid()
    or assignee_id = auth.uid()
    or column_id in (
      select c.id from public.columns c
      join public.boards b on b.id = c.board_id
      join public.project_members pm on pm.project_id = b.project_id
      where pm.user_id = auth.uid() and pm.role = 'owner'
    )
  );

-- labels ---------------------------------------------------------------------
drop policy if exists labels_all on public.labels;

create policy labels_all on public.labels
  for all using (project_id in (select private.user_project_ids()))
  with check (project_id in (select private.user_project_ids()));

-- task_labels (m2m) ----------------------------------------------------------
drop policy if exists task_labels_all on public.task_labels;

create policy task_labels_all on public.task_labels
  for all using (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  )
  with check (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

-- task_comments --------------------------------------------------------------
drop policy if exists tc_select        on public.task_comments;
drop policy if exists tc_insert       on public.task_comments;
drop policy if exists tc_update_own   on public.task_comments;
drop policy if exists tc_delete_own   on public.task_comments;

create policy tc_select on public.task_comments
  for select using (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy tc_insert on public.task_comments
  for insert with check (
    user_id = auth.uid()
    and task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy tc_update_own on public.task_comments
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy tc_delete_own on public.task_comments
  for delete using (user_id = auth.uid());

-- workflows ------------------------------------------------------------------
drop policy if exists workflows_all on public.workflows;

create policy workflows_all on public.workflows
  for all using (project_id in (select private.user_project_ids()))
  with check (project_id in (select private.user_project_ids()));

-- workflow_stages ------------------------------------------------------------
drop policy if exists workflow_stages_all on public.workflow_stages;

create policy workflow_stages_all on public.workflow_stages
  for all using (
    workflow_id in (
      select w.id from public.workflows w
      where w.project_id in (select private.user_project_ids())
    )
  )
  with check (
    workflow_id in (
      select w.id from public.workflows w
      where w.project_id in (select private.user_project_ids())
    )
  );

-- approval_requests ----------------------------------------------------------
drop policy if exists ar_select on public.approval_requests;
drop policy if exists ar_write  on public.approval_requests;

create policy ar_select on public.approval_requests
  for select using (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

create policy ar_write on public.approval_requests
  for all using (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  )
  with check (
    task_id in (
      select t.id from public.tasks t
      join public.columns c on c.id = t.column_id
      join public.boards b on b.id = c.board_id
      where b.project_id in (select private.user_project_ids())
    )
  );

-- notifications --------------------------------------------------------------
drop policy if exists notif_select_own on public.notifications;
drop policy if exists notif_update_own on public.notifications;
drop policy if exists notif_delete_own on public.notifications;

create policy notif_select_own on public.notifications
  for select using (user_id = auth.uid());

create policy notif_update_own on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notif_delete_own on public.notifications
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Grants for authenticated role
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant all on all tables    in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Realtime publication (so Phase 7 subscriptions receive events)
-- ---------------------------------------------------------------------------
-- Add core collaboration tables to the realtime publication.
-- Safe to run multiple times.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'approval_requests'
  ) then
    alter publication supabase_realtime add table public.approval_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================
-- End of initial schema migration
-- ============================================================================