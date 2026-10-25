-- ============================================================================
-- DAVE — Login Diagnostic & Repair (LOCAL / DEV ONLY)
-- Created: 2026-10-11
--
-- Use this when mock developers exist in DB but /login fails with
-- "Invalid login credentials".
--
-- Copy-paste from top to bottom in Supabase SQL Editor; each section prints
-- what it found, then the next section fixes it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DIAGNOSE — what's the actual state of these mock users?
-- ---------------------------------------------------------------------------
select
  u.id,
  u.email,
  u.email_confirmed_at is not null             as email_verified,
  length(u.encrypted_password)                 as hash_length,
  substring(u.encrypted_password, 1, 4)        as hash_prefix,    -- $2a$ = bcrypt (good), $1$ = md5 (bad), $sha$... etc.
  exists(select 1 from auth.identities i
          where i.user_id = u.id and i.provider = 'email')
                                               as has_email_identity,
  exists(select 1 from public.profiles p where p.id = u.id)
                                               as has_profile_row,
  p.email                                      as profile_email
from auth.users u
left join public.profiles p on p.id = u.id
where u.email in ('aarav@dave.test','priya@dave.test','karthik@dave.test')
order by u.email;

-- Read the output. Then proceed to the FIX blocks below depending on what
-- you see. Most common failures:
--   * `email_verified`        = false   → uncomment FIX-A below
--   * `hash_prefix` != '$2a$' / '$2b$' / '$2y$'  → uncomment FIX-B below
--   * `has_email_identity`    = false   → uncomment FIX-C below
--   * `has_profile_row`       = false   → uncomment FIX-D below
--   * `has_profile_row`=true but `profile_email`=NULL → uncomment FIX-E below
--   * row missing entirely    → re-run supabase/seed.sql

-- ---------------------------------------------------------------------------
-- FIX-A — Force-confirm emails (most common cause)
-- ---------------------------------------------------------------------------
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email like '%@dave.test';

-- ---------------------------------------------------------------------------
-- FIX-B — Re-hash password using bcrypt explicitly
--         (only run if hash_prefix is NOT $2a$ / $2b$ / $2y$)
-- ---------------------------------------------------------------------------
-- update auth.users
--    set encrypted_password = crypt('dev123', gen_salt('bf', 10))
--  where email like '%@dave.test';

-- ---------------------------------------------------------------------------
-- FIX-C — Re-create missing email identities
-- ---------------------------------------------------------------------------
insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
select gen_random_uuid(),
       u.id,
       jsonb_build_object(
         'sub', u.id,
         'email', u.email,
         'email_verified', true,
         'provider', 'email'
       ),
       'email',
       u.email,
       now(),
       now()
  from auth.users u
 where u.email like '%@dave.test'
   and not exists (
     select 1 from auth.identities i
      where i.user_id = u.id and i.provider = 'email'
   );

-- ---------------------------------------------------------------------------
-- FIX-D — Create missing profile rows
-- ---------------------------------------------------------------------------
insert into public.profiles (id, name, email, role, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       u.email,
       coalesce(u.raw_user_meta_data->>'role', 'dev'),
       'https://api.dicebear.com/9.x/initials/svg?seed=' ||
         coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
  from auth.users u
 where u.email like '%@dave.test'
   and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- FIX-E — Backfill profile email/role from auth.users
-- ---------------------------------------------------------------------------
update public.profiles p
   set email      = u.email,
       role       = coalesce(p.role, 'dev'),
       avatar_url = coalesce(p.avatar_url,
                             'https://api.dicebear.com/9.x/initials/svg?seed=' ||
                             coalesce(p.name, split_part(u.email, '@', 1))),
       updated_at = now()
  from auth.users u
 where p.id = u.id
   and u.email like '%@dave.test'
   and (p.email is null or p.email <> u.email);

-- ---------------------------------------------------------------------------
-- 2. VERIFY — should show 3 ready-to-login rows
-- ---------------------------------------------------------------------------
select
  u.email,
  u.email_confirmed_at is not null as verified,
  substring(u.encrypted_password, 1, 4) as hash_algo,
  exists(select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as identity_ok,
  exists(select 1 from public.profiles p where p.id = u.id and p.email = u.email) as profile_ok
from auth.users u
where u.email in ('aarav@dave.test','priya@dave.test','karthik@dave.test')
order by u.email;

-- ---------------------------------------------------------------------------
-- 3. PASSWORD HASH VERIFICATION (optional sanity test)
--    This proves bcrypt('dev123') matches what's stored. Should return true
--    for all 3 rows.
-- ---------------------------------------------------------------------------
select
  u.email,
  (u.encrypted_password = crypt('dev123', u.encrypted_password)) as password_matches
from auth.users u
where u.email in ('aarav@dave.test','priya@dave.test','karthik@dave.test')
order by u.email;
