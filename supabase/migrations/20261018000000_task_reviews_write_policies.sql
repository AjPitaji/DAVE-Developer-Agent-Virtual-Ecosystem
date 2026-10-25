-- ============================================================================
-- DAVE - task_reviews RLS write policies
--
-- The original task_reviews migration only added a SELECT policy. The
-- Dwight review API runs as the authenticated user (not the service role)
-- and needs to INSERT new review rows + UPDATE them with log entries and
-- the final verdict. Without these policies, the API hits
--   "new row violates row-level security policy for table 'task_reviews'"
-- the moment it tries to create the pending review row.
--
-- The new policies mirror the existing SELECT policy: a user can read /
-- write a review iff they are a member of the project the review belongs
-- to. We don't restrict the writer to triggered_by because Dwight
-- sometimes re-runs a review on a different user's behalf and the task
-- itself is project-scoped already.
-- ============================================================================

drop policy if exists task_reviews_insert on public.task_reviews;
create policy task_reviews_insert on public.task_reviews
  for insert with check (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = task_reviews.project_id
        and pm.user_id    = auth.uid()
    )
  );

drop policy if exists task_reviews_update on public.task_reviews;
create policy task_reviews_update on public.task_reviews
  for update
  using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = task_reviews.project_id
        and pm.user_id    = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = task_reviews.project_id
        and pm.user_id    = auth.uid()
    )
  );

drop policy if exists task_reviews_delete on public.task_reviews;
create policy task_reviews_delete on public.task_reviews
  for delete using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = task_reviews.project_id
        and pm.user_id    = auth.uid()
    )
  );