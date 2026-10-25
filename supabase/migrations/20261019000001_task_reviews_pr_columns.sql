-- ============================================================================
-- DAVE - PR linkage on task_reviews
--
-- When a task has a linked GitHub PR, Dwight reviews the PR diff instead
-- of the default-branch HEAD. We record the PR number + URL on the
-- review row so the Dwight panel and task card can show "this review
-- covered PR #42" without re-fetching from GitHub.
-- ============================================================================

alter table public.task_reviews
  add column if not exists pr_number int
    check (pr_number is null or pr_number > 0);

alter table public.task_reviews
  add column if not exists pr_url text;

create index if not exists idx_task_reviews_pr_number
  on public.task_reviews(pr_number)
  where pr_number is not null;