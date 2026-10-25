-- ============================================================================
-- DAVE - Dwight activity log column
--
-- Adds the `log` jsonb column to an existing `task_reviews` table. This is
-- a follow-up to the original task_reviews migration in case the table
-- was created before the live activity log was added. Safe to run
-- multiple times: the column add is guarded by `if not exists`.
--
-- Paste this into the Supabase SQL Editor and run it as a single batch.
-- ============================================================================

alter table public.task_reviews
  add column if not exists log jsonb not null default '[]'::jsonb;