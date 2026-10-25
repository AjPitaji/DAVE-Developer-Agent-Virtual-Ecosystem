-- ============================================================================
-- team_agents: AI team members with predefined system prompts
-- ============================================================================

create table if not exists public.team_agents (
  team_id      uuid not null references public.teams(id) on delete cascade,
  agent_id     text not null,
  name         text not null,
  role         text not null,
  description  text,
  avatar       text,
  system_prompt text not null,
  added_by     uuid references public.profiles(id) on delete set null,
  added_at     timestamptz not null default now(),
  primary key (team_id, agent_id)
);

create index if not exists idx_team_agents_team_id on public.team_agents(team_id);

alter table public.team_agents enable row level security;

drop policy if exists team_agents_select on public.team_agents;
create policy team_agents_select on public.team_agents
  for select using (team_id in (select private.user_team_ids()));

drop policy if exists team_agents_insert on public.team_agents;
create policy team_agents_insert on public.team_agents
  for insert with check (team_id in (select private.user_team_ids()));

drop policy if exists team_agents_delete on public.team_agents;
create policy team_agents_delete on public.team_agents
  for delete using (team_id in (select private.user_team_ids()));
