-- ============================================================================
-- DAVE — profiles.email backfill
-- Created: 2026-10-06
--
-- WHY THIS EXISTS
--   Several client queries join `profiles` and select `email` /`role`:
--     app/teams/[id]      -> team_members -> profiles(id, name, email, ...)
--     app/teams/discover  -> profiles(...) for the owner "Led by" line
--     app/dashboard       -> profiles.role for the default view mode
--   But public.profiles only ever had (id, name, avatar_url, created_at,
--   updated_at). Email lives in auth.users and role lives in
--   auth.users.raw_user_meta_data->>'role'. PostgREST therefore rejected the
--   query with:
--     42703 column profiles_1.email does not exist
--   which broke the whole team page (member roster AND pending join
--   requests) because the query threw before any of it rendered.
--
-- WHAT THIS DOES
--   1. Adds nullable `email` and `role` columns to public.profiles.
--   2. Backfills existing rows from auth.users / raw_user_meta_data.
--   3. Keeps them in sync on signup + on auth.users email change, via
--      triggers.
--   4. Adds a security-definer RPC the app already calls
--      (`profile_by_email`) which was referenced in code but never defined.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists email text,
  add column if not exists role text;

create unique index if not exists uq_profiles_email
  on public.profiles(email)
  where email is not null;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows
-- ---------------------------------------------------------------------------
update public.profiles p
set email = u.email::text
from auth.users u
where u.id = p.id
  and (p.email is null or p.email <> u.email::text);

-- role: prefer whatever was captured at signup, else default to 'dev'
update public.profiles p
set role = coalesce(u.raw_user_meta_data->>'role', 'dev')
from auth.users u
where u.id = p.id
  and (p.role is null or p.role <> coalesce(u.raw_user_meta_data->>'role', 'dev'));

update public.profiles
set role = 'dev'
where role is null;

-- ---------------------------------------------------------------------------
-- 3. Keep profiles in sync with auth.users
-- ---------------------------------------------------------------------------

-- 3a. On signup: reuse the existing handle_new_user trigger pattern, but make
--     it populate email + role too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.email::text,
    coalesce(new.raw_user_meta_data->>'role', 'dev')
  )
  on conflict (id) do update
    set email = excluded.email,
        role  = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3b. If a user changes their email or metadata later, keep profiles current.
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email::text,
      role  = coalesce(new.raw_user_meta_data->>'role', role, 'dev')
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_auth_user_updated();

-- ---------------------------------------------------------------------------
-- 4. profile_by_email RPC
--    The team page calls this to resolve an email to a profile when adding a
--    developer by email. It was referenced in client code but never created,
--    so that form would have thrown 404 / PGRST202 at runtime.
-- ---------------------------------------------------------------------------
create or replace function public.profile_by_email(p_email text)
returns table (id uuid, name text, email text, avatar_url text)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id,
         p.name,
         p.email,
         p.avatar_url
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.profile_by_email(text) from public;
grant execute on function public.profile_by_email(text) to authenticated;