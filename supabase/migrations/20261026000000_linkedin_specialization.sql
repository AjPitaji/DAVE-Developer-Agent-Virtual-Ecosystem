-- ============================================================================
-- DAVE — Developer specialization for team owners and Michael
-- Created: 2026-10-26
--
-- 1. profiles.specialization
--    A short, self-declared line ("Frontend dev — React, Next.js, Tailwind").
--    This is the only source of "what does this person actually work on":
--    Michael reads it to route work to the right teammate, and team owners
--    read it to review a candidate before approving their join request.
--
-- 2. pending_join_requests()
--    Recreated to also return the requester's specialization so the
--    "Pending Join Requests" panel can show the owner what the candidate
--    has been working on before approving them.
--
--    Postgres cannot change the return type of an existing function with
--    CREATE OR REPLACE, so the function is dropped and recreated here. It is
--    dropped and recreated in the same transaction, so there is no window in
--    which the RPC is missing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Self-declared specialization
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists specialization text;

comment on column public.profiles.specialization is
  'Developer-declared specialty (e.g. "Frontend — React, Next.js"). Used by Michael for task assignment and shown to team owners reviewing a join request.';

-- ---------------------------------------------------------------------------
-- 2. pending_join_requests() with specialization
-- ---------------------------------------------------------------------------
drop function if exists public.pending_join_requests();

create function public.pending_join_requests()
returns table (
  id                       uuid,
  team_id                  uuid,
  user_id                  uuid,
  message                  text,
  created_at               timestamptz,
  status                   text,
  requester_name           text,
  requester_email          text,
  requester_avatar         text,
  requester_specialization text
)
language sql
security definer
set search_path = ''
stable
as $$
  select r.id,
         r.team_id,
         r.user_id,
         r.message,
         r.created_at,
         r.status::text,
         p.name,
         p.email,
         p.avatar_url,
         p.specialization
  from public.team_join_requests r
  join public.profiles p on p.id = r.user_id
  where r.status = 'pending'
    and exists (
      select 1 from public.team_members m
      where m.team_id = r.team_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  order by r.created_at desc
$$;

revoke all on function public.pending_join_requests() from public;
grant execute on function public.pending_join_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
-- 1. The new column exists. Expect 1 row.
-- select column_name, data_type from information_schema.columns
--  where table_name = 'profiles' and column_name = 'specialization';
--
-- 2. The function exists with the new columns. Expect 10 columns.
-- select proname from pg_proc where proname = 'pending_join_requests';
--
-- 3. As a team owner, this returns your pending requests including the
--    requester's specialization. Expect one row per pending request.
-- select id, requester_name, requester_specialization
--   from public.pending_join_requests();
