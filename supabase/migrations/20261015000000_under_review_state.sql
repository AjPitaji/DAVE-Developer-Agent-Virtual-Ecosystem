-- ============================================================================
-- DAVE - Under-review state for Dwight
--
-- 1. Add 'under_review' to the task_status enum so Dwight owns a transient
--    state between "user marked done" and "Dwight finished reviewing".
-- 2. Denormalise the latest review's id and verdict on the task itself so
--    the board can render verdict badges and a review pulse without an
--    extra query.
--
-- We add the enum value in its own ALTER TYPE statement (separate from the
-- ALTER TABLE) because PostgreSQL forbids using a freshly-added enum value
-- in the same transaction it was added in. The column additions are
-- independent of the enum so they're safe to ship in one migration file.
-- ============================================================================

-- 1. Extend the task_status enum with the new transient state.
alter type public.task_status add value if not exists 'under_review';

-- 2. Denormalised review pointers on the task.
alter table public.tasks
  add column if not exists last_review_id      uuid references public.task_reviews(id) on delete set null;
alter table public.tasks
  add column if not exists last_review_verdict text
    check (last_review_verdict is null or last_review_verdict in ('approved','changes_requested','comment'));

create index if not exists idx_tasks_last_review_id on public.tasks(last_review_id);