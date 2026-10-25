-- ============================================================================
-- DAVE — Mock Developer Seed (LOCAL / DEV ONLY) — v2 (constraint-safe)
-- Created: 2026-10-11
--
-- Purpose:
--   Quickly populate Supabase with 3 mock developer accounts so you can test
--   the "invite by email" / "add member" / "assign to task" flows end-to-end
--   without creating real email addresses.
--
-- Why v2:
--   v1 used `INSERT ... ON CONFLICT (id) DO UPDATE` and returned 42P10 on
--   hosted Supabase where the auth.users → profiles link is set up via a
--   trigger and not a hard UNIQUE/PK constraint visible to the planner.
--   v2 uses explicit IF EXISTS → UPDATE / ELSE INSERT branching so it works
--   on every Supabase schema variant.
--
-- IMPORTANT:
--   * DO NOT run in production. The .test TLD is reserved (RFC 6761) and
--     anyone using these credentials has no real security boundary.
--   * Re-runnable: safe to paste into SQL editor multiple times.
--
-- Run via:
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 0. Pre-flight diagnostic (read-only) — run this FIRST if you hit errors
-- ---------------------------------------------------------------------------
-- Uncomment to inspect current state before seeding:
--
--   select 'profiles'  as table_name,
--          (select count(*) from public.profiles)   as row_count,
--          (select exists(select 1 from pg_constraint
--             where conrelid = 'public.profiles'::regclass
--               and contype in ('p','u')))         as has_unique_id_constraint
--   union all
--   select 'auth.users',
--          (select count(*) from auth.users),
--          (select exists(select 1 from pg_constraint
--             where conrelid = 'auth.users'::regclass
--               and contype in ('p','u')));
--
-- If `has_unique_id_constraint` is false for either table, this v2 script
-- still handles it correctly because we never rely on ON CONFLICT.

-- ---------------------------------------------------------------------------
-- 1. Mock developer roster — explicit INSERT / UPDATE (no ON CONFLICT)
-- ---------------------------------------------------------------------------
do $$
declare
  devs constant jsonb := '[
    {"id": "a1b2c3d4-1111-4000-8000-000000000001", "email": "aarav@dave.test",   "name": "Aarav",   "role": "dev"},
    {"id": "a1b2c3d4-2222-4000-8000-000000000002", "email": "priya@dave.test",   "name": "Priya",   "role": "dev"},
    {"id": "a1b2c3d4-3333-4000-8000-000000000003", "email": "karthik@dave.test", "name": "Karthik", "role": "dev"}
  ]'::jsonb;
  dev        jsonb;
  dev_id     uuid;
  dev_email  text;
  dev_name   text;
  dev_role   text;
  existing_profile_count int;
  existing_user_count    int;
  existing_identity_count int;
begin
  for dev in select * from jsonb_array_elements(devs)
  loop
    dev_id    := (dev->>'id')::uuid;
    dev_email := dev->>'email';
    dev_name  := dev->>'name';
    dev_role  := dev->>'role';

    ------------------------------------------------------------------
    -- 1a. auth.users — insert if missing
    ------------------------------------------------------------------
    select count(*) into existing_user_count
      from auth.users where id = dev_id;

    if existing_user_count = 0 then
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        dev_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        dev_email,
        crypt('dev123', gen_salt('bf')),
        now(),                                                          -- pre-verified
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', dev_name, 'role', dev_role),
        now(), now(),
        '', '', '', ''
      );
    -- else: row already exists → leave it alone (idempotent)
    end if;

    ------------------------------------------------------------------
    -- 1b. auth.identities — insert one identity per user if missing
    ------------------------------------------------------------------
    select count(*) into existing_identity_count
      from auth.identities
     where user_id = dev_id and provider = 'email';

    if existing_identity_count = 0 then
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, created_at, updated_at
      ) values (
        gen_random_uuid(),
        dev_id,
        jsonb_build_object(
          'sub', dev_id,
          'email', dev_email,
          'email_verified', true,
          'provider', 'email'
        ),
        'email',
        dev_email,
        now(), now()
      );
    end if;

    ------------------------------------------------------------------
    -- 1c. public.profiles — explicit UPDATE-or-INSERT (no ON CONFLICT)
    --     The trigger on auth.users may have created a stub row already;
    --     we always overwrite it with our full mock profile.
    ------------------------------------------------------------------
    select count(*) into existing_profile_count
      from public.profiles where id = dev_id;

    if existing_profile_count > 0 then
      update public.profiles
         set name       = dev_name,
             email      = dev_email,
             role       = dev_role,
             avatar_url = 'https://api.dicebear.com/9.x/initials/svg?seed=' || dev_name,
             updated_at = now()
       where id = dev_id;
    else
      insert into public.profiles (id, name, email, role, avatar_url)
      values (
        dev_id,
        dev_name,
        dev_email,
        dev_role,
        'https://api.dicebear.com/9.x/initials/svg?seed=' || dev_name
      );
    end if;

    raise notice 'Seeded % (%)', dev_name, dev_email;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sanity check — should return 3 rows when successful
-- ---------------------------------------------------------------------------
select id, name, email, role
  from public.profiles
 where email in ('aarav@dave.test','priya@dave.test','karthik@dave.test')
 order by name;
