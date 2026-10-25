-- ============================================================================
-- DAVE - GitHub profile and repository links
-- Created: 2026-10-06
--
-- Adds:
--   * profiles.github_username — the account's GitHub handle. Stored as the
--     bare handle (not a URL) so the profile URL can be derived and the
--     handle stays editable if the user changes their vanity URL.
--   * projects.repo_url       — the GitHub repository backing this Epic.
--
-- Why store the handle rather than the full profile URL:
--   https://github.com/<handle> is derivable, and storing the handle means a
--   single column powers both the profile link and the repo suggestion on the
--   project form. It also avoids users pasting a URL with a trailing slash,
--   an http/https mix, or an accidental trailing path.
--
-- RLS note: no new policies are required.
--   * profiles already has profiles_update_own (id = auth.uid()), so a user
--     can edit their own github_username.
--   * projects already has projects_update_owners, so a project owner can set
--     repo_url on an existing project.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists github_username text;

alter table public.projects
  add column if not exists repo_url text;

-- ---------------------------------------------------------------------------
-- 2. Validation constraints
--
-- Applied NOT VALID so existing rows with a NULL are unaffected, and so the
-- constraint is enforced on all future INSERT/UPDATE without a long lock.
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_github_username_format;

alter table public.profiles
  add constraint profiles_github_username_format
  check (
    github_username is null
    or github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$'
  ) not valid;

alter table public.projects
  drop constraint if exists projects_repo_url_format;

alter table public.projects
  add constraint projects_repo_url_format
  check (
    repo_url is null
    or repo_url ~ '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/?$'
  ) not valid;

-- ---------------------------------------------------------------------------
-- 3. Helper: derive a GitHub profile URL from a handle
--
-- Returns NULL rather than an empty string for a missing handle so callers can
-- use IS NOT NULL, and trims a leading '@' since users habitually paste one.
-- ---------------------------------------------------------------------------
create or replace function public.github_profile_url(p_handle text)
returns text
language sql
immutable
as $$
  select case
    when p_handle is null or btrim(p_handle) = '' then null
    else 'https://github.com/' || btrim(p_handle, '@ ')
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Surface a repo URL and owner handle when loading a project
--
-- The project page previously fetched `projects` with a nested `teams(name)`
-- select. Widening that select is cheaper than an extra round trip, and keeps
-- the RLS surface unchanged: projects are already readable via
-- projects_select_team_members / projects_select_public_team.
-- ---------------------------------------------------------------------------
-- (No policy changes needed. Documented here so the reasoning is not lost.)

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Columns exist. Expect 2 rows.
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where (table_name = 'profiles'   and column_name = 'github_username')
--     or (table_name = 'projects'   and column_name = 'repo_url');

-- Handle validation. Should return the literal.
-- select public.github_profile_url('  @octocat  ') as url;  -- https://github.com/octocat
-- select public.github_profile_url(null)         as url;  -- null
-- ============================================================================