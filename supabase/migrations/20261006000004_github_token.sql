-- ============================================================================
-- DAVE - GitHub personal access token
-- Created: 2026-10-06
--
-- Adds `profiles.github_token` so the app can call the GitHub API on the
-- user's behalf (e.g. to create a repo for a project). The token is stored
-- as-is; the app should treat it as a secret and never expose it to the
-- browser.
-- ============================================================================

alter table public.profiles
  add column if not exists github_token text;
