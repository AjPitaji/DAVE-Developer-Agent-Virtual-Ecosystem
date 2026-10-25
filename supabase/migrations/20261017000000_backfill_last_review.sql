-- ============================================================================
-- DAVE - Backfill tasks.last_review_id / last_review_verdict
--
-- The Dwight review API stamps these two denormalised columns on the task
-- every time it applies a verdict. For tasks that were reviewed before
-- those columns existed (or before the verdict-application logic landed)
-- they are still NULL even though the review row exists in task_reviews.
--
-- This migration walks every task that has at least one review in
-- task_reviews and copies the LATEST review's id + verdict (only when the
-- review has actually completed — pending / failed reviews don't get a
-- verdict). Safe to re-run: it overwrites with the same data.
-- ============================================================================

with latest_reviews as (
  select distinct on (task_id)
    id,
    task_id,
    verdict,
    status
  from public.task_reviews
  order by task_id, created_at desc
)
update public.tasks as t
set
  last_review_id       = lr.id,
  last_review_verdict  = case
                           when lr.status = 'completed' then lr.verdict
                           else null
                         end
from latest_reviews as lr
where t.id = lr.task_id
  and (
    t.last_review_id       is distinct from lr.id
    or t.last_review_verdict is distinct from (
      case when lr.status = 'completed' then lr.verdict else null end
    )
  );