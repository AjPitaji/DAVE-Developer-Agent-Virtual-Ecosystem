-- ============================================================================
-- DAVE - Michael's additional prompt (the team's brief)
-- Created: 2026-10-31
--
-- WHAT THIS ADDS
--   public.project_michael_settings
--     A one-row-per-project store for the extra instructions the team writes
--     for Michael, the AI task planner. It is what the "Extra instructions for
--     Michael" box in the Michael tab edits.
--
-- WHY A TABLE AND NOT A COLUMN ON projects
--   The obvious home for this would be a `projects.michael_prompt` column, but
--   the projects table is owner-only for writes (projects_update_owners gates
--   UPDATE on owner_id or a project_members row with role = 'owner'). A
--   developer on the team would get an RLS error the moment they tried to
--   save a note about the work they are about to plan.
--
--   The brief is working context for task planning, not project governance,
--   so it gets its own table with member-level write access. Any member of
--   the project can read and write it; everyone on the project sees the same
--   brief, which is what makes it useful.
--
-- PERMISSIONS
--   private.user_project_ids() is the same gate used by boards, columns,
--   tasks and comments. It covers explicit project members and team members
--   (widened in 20261006000001), so both the project owner and any developer
--   on the team can use this.
--
-- HOW TO RUN IT
--   Safe to paste straight into the Supabase SQL Editor. Idempotent: safe to
--   re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.project_michael_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  prompt      text check (prompt is null or length(prompt) <= 4000),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_project_michael_settings_project_id
  on public.project_michael_settings(project_id);

-- ---------------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------------
alter table public.project_michael_settings enable row level security;

drop policy if exists pms_select on public.project_michael_settings;
create policy pms_select on public.project_michael_settings
  for select using (project_id in (select private.user_project_ids()));

drop policy if exists pms_insert on public.project_michael_settings;
create policy pms_insert on public.project_michael_settings
  for insert with check (project_id in (select private.user_project_ids()));

drop policy if exists pms_update on public.project_michael_settings;
create policy pms_update on public.project_michael_settings
  for update using (project_id in (select private.user_project_ids()))
  with check (project_id in (select private.user_project_ids()));

drop policy if exists pms_delete on public.project_michael_settings;
create policy pms_delete on public.project_michael_settings
  for delete using (project_id in (select private.user_project_ids()));

-- ---------------------------------------------------------------------------
-- 3. Grants
--
-- The base schema granted `all on all tables in schema public` once, which
-- only covers the tables that existed at that moment. Supabase normally
-- provides default privileges for new tables, but granting explicitly means
-- this table works even on a project where those defaults were never set.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant all on public.project_michael_settings to authenticated;

-- ============================================================================
-- USAGE
--
--   select * from public.project_michael_settings where project_id = '<uuid>';
--
-- The app reads the brief with GET /api/michael/[projectId], saves it with
-- PUT, and passes it to the model on every generate call.
-- ============================================================================
