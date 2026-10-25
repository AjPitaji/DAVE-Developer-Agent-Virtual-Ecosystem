-- ============================================================================
-- DAVE — Remove the LinkedIn connection
-- Created: 2026-10-27
--
-- DAVE no longer offers LinkedIn Sign In. Users declare a `specialization`
-- themselves (see 20261026000000_linkedin_specialization.sql), which is the
-- single source of "what does this person work on".
--
-- This migration cleans up databases provisioned BEFORE the LinkedIn
-- integration was removed. Fresh databases never get the columns in the
-- first place: the migration that used to add them was deleted, and the
-- `pending_join_requests()` RPC was changed to stop referencing them.
--
-- Order matters here:
--   1. Drop the RPC first — its body selects the linkedin_* columns.
--   2. Drop the columns.
--   3. Recreate the RPC without them.
-- Postgres does not track column dependencies from a function body, so the
-- drop would not fail on its own; we still drop the function first so the
-- RPC is never observable in a broken state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Make sure the replacement column exists
-- ---------------------------------------------------------------------------
-- The RPC below selects `p.specialization`. This migration is applied by
-- hand through the Supabase SQL Editor, where migration ordering is not
-- enforced, so make the dependency explicit rather than assuming
-- 20261026000000 ran first.
alter table public.profiles
  add column if not exists specialization text;

-- ---------------------------------------------------------------------------
-- 1. Remove the RPC while it still references the old columns
-- ---------------------------------------------------------------------------
drop function if exists public.pending_join_requests();

-- ---------------------------------------------------------------------------
-- 2. Drop the LinkedIn profile columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop column if exists linkedin_id,
  drop column if exists linkedin_name,
  drop column if exists linkedin_email,
  drop column if exists linkedin_headline,
  drop column if exists linkedin_vanity_name,
  drop column if exists linkedin_profile_url,
  drop column if exists linkedin_picture_url,
  drop column if exists linkedin_locale,
  drop column if exists linkedin_connected_at;

-- NOTE: the function body deliberately has NO trailing semicolon.
-- The Supabase SQL Editor splits a pasted script on every `;`, even ones
-- inside a dollar-quoted body. A `;` at the end of the SELECT makes the
-- editor cut the statement there and strand the closing `$$` in a
-- separate fragment, which fails with
--   ERROR: unterminated dollar-quoted string
-- Postgres accepts a single-statement `language sql` body without it.
--
-- ---------------------------------------------------------------------------
-- 3. Recreate the RPC with the specialization only
-- ---------------------------------------------------------------------------
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
-- 1. No linkedin_* columns remain. Expect 0 rows.
-- select column_name from information_schema.columns
--  where table_name = 'profiles' and column_name like 'linkedin%';
--
-- 2. The RPC exists and returns 10 columns.
-- select proname from pg_proc where proname = 'pending_join_requests';
--
-- 3. The specialization column survived the cleanup. Expect 1 row.
-- select column_name from information_schema.columns
--  where table_name = 'profiles' and column_name = 'specialization';
