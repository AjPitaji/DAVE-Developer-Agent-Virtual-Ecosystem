-- ============================================================================
-- DAVE - task_reviews RLS write policies (v2)
--
-- Wider version of 20261018000000_task_reviews_write_policies.sql. The v1
-- policies required the user to be a row in `project_members`, which fails
-- for projects where the auto-add-owner trigger didn't fire (older data)
-- or for users who only joined the underlying team.
--
-- The v2 policies match what the Dwight API already does explicitly: a
-- user can read / write a review iff they either
--   1. own the project, or
--   2. have any project_members row for the project (the API also
--      restricts to owner / dev roles — RLS is the broader gate).
--
-- We use the existing `private.user_project_ids()` SECURITY DEFINER
-- function for the membership check so this matches every other table's
-- RLS pattern in the codebase.
-- ============================================================================

drop policy if exists task_reviews_select on public.task_reviews;
create policy task_reviews_select on public.task_reviews
  for select using (
    exists (
      select 1
      from public.projects p
      where p.id = task_reviews.project_id
        and (
          p.owner_id = auth.uid()
          or p.id in (select private.user_project_ids())
        )
    )
  );

drop policy if exists task_reviews_insert on public.task_reviews;
create policy task_reviews_insert on public.task_reviews
  for insert with check (
    exists (
      select 1
      from public.projects p
      where p.id = task_reviews.project_id
        and (
          p.owner_id = auth.uid()
          or p.id in (select private.user_project_ids())
        )
    )
  );

drop policy if exists task_reviews_update on public.task_reviews;
create policy task_reviews_update on public.task_reviews
  for update
  using (
    exists (
      select 1
      from public.projects p
      where p.id = task_reviews.project_id
        and (
          p.owner_id = auth.uid()
          or p.id in (select private.user_project_ids())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = task_reviews.project_id
        and (
          p.owner_id = auth.uid()
          or p.id in (select private.user_project_ids())
        )
    )
  );

drop policy if exists task_reviews_delete on public.task_reviews;
create policy task_reviews_delete on public.task_reviews
  for delete using (
    exists (
      select 1
      from public.projects p
      where p.id = task_reviews.project_id
        and (
          p.owner_id = auth.uid()
          or p.id in (select private.user_project_ids())
        )
    )
  );