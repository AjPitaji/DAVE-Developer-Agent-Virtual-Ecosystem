-- Add assignee_agent_id to tasks so AI team agents (bots) can be assigned tasks.
alter table public.tasks add column if not exists assignee_agent_id text;

create index if not exists idx_tasks_assignee_agent_id on public.tasks(assignee_agent_id);