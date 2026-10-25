-- ============================================================================
-- DAVE - Dwight (AI code reviewer) review storage
-- One row per Dwight review. Triggered automatically when a task is moved
-- to the "done" column; can also be triggered manually from the Dwight tab.
--
-- Keep the verdict as plain `text` + CHECK constraint, same pattern as
-- team_join_requests: avoids custom enum types that don't paste cleanly into
-- the Supabase SQL Editor.
-- ============================================================================

create table if not exists public.task_reviews (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  task_id         uuid not null references public.tasks(id)    on delete cascade,
  -- 'approved' | 'changes_requested' | 'comment'
  verdict         text not null default 'comment'
                    check (verdict in ('approved','changes_requested','comment')),
  summary         text not null default '',
  -- Array of { path, summary, severity, note }. Severity is one of
  -- 'info' | 'minor' | 'major' | 'critical'.
  findings        jsonb not null default '[]'::jsonb,
  -- Optional longer markdown body Dwight produced.
  body_markdown   text not null default '',
  -- What Dwight actually reviewed.
  branch          text not null default '',
  commit_sha      text not null default '',
  commit_short_sha text not null default '',
  commit_message  text not null default '',
  files_reviewed  jsonb not null default '[]'::jsonb,
  -- Live activity log: one entry per step (start/ok/error/info) so the
  -- Dwight panel can show a real-time terminal of what's happening.
  -- Each entry: { ts, step, status, detail?, duration_ms? }.
  log             jsonb not null default '[]'::jsonb,
  -- Review lifecycle (separate from verdict).
  status          text not null default 'completed'
                    check (status in ('pending','completed','failed')),
  error_message   text,
  triggered_by    uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_task_reviews_project_created
  on public.task_reviews(project_id, created_at desc);
create index if not exists idx_task_reviews_task_created
  on public.task_reviews(task_id, created_at desc);

drop trigger if exists task_reviews_updated_at on public.task_reviews;
create trigger task_reviews_updated_at
  before update on public.task_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Project members can read every review on their project. Only the system
-- (service role) and the trigger that creates them should insert/update, but
-- the API routes run as the authenticated user so they go through normal RLS.
-- We mirror the existing project_members-based pattern.
-- ---------------------------------------------------------------------------
alter table public.task_reviews enable row level security;

drop policy if exists task_reviews_select on public.task_reviews;
create policy task_reviews_select on public.task_reviews
  for select using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = task_reviews.project_id
        and pm.user_id    = auth.uid()
    )
  );

-- Inserts/updates happen via the service-role key on the server, so no
-- authenticated-user write policies are needed. If you ever want clients to
-- write directly, add a WITH CHECK matching the select policy above.