-- ============================================================================
-- DAVE - Developer Discovery Flow
-- PART 2 of 2: security-definer RPC functions
--
-- Run this as a SEPARATE paste, AFTER part 1 succeeds.
--
-- Why functions instead of policies: each of these needs a cross-table check
-- ("is this team public?", "do I own this team?", "how many members does this
-- team have?"). Expressing those as policy subqueries chains RLS dependencies
-- together and Postgres aborts with 42P17. A SECURITY DEFINER function runs as
-- the table owner, so the tables it reads are not subject to RLS at all, and
-- no policy dependency cycle is created.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- discover_teams(): the whole discovery feed in one round trip.
--
-- Returns public teams with member count, project count, owner name, and the
-- calling user's existing request status. Teams the caller already belongs to
-- are filtered out.
-- ---------------------------------------------------------------------------
create or replace function public.discover_teams()
returns table (
  id               uuid,
  name             text,
  description      text,
  owner_id         uuid,
  owner_name       text,
  created_at       timestamptz,
  member_count     bigint,
  project_count    bigint,
  request_status   text,
  request_id       uuid
)
language sql
security definer
set search_path = ''
stable
as $$
  with mine as (
    select r.team_id, r.id, r.status::text as status
    from public.team_join_requests r
    where r.user_id = auth.uid()
  )
  select t.id,
         t.name,
         t.description,
         t.owner_id,
         op.name,
         t.created_at,
         (select count(*) from public.team_members m where m.team_id = t.id),
         (select count(*) from public.projects   p where p.team_id = t.id),
         coalesce(mine.status, 'none'),
         mine.id
  from public.teams t
  left join public.profiles op on op.id = t.owner_id
  left join mine on mine.team_id = t.id
  where t.is_public = true
    and not exists (
      select 1 from public.team_members m2
      where m2.team_id = t.id and m2.user_id = auth.uid()
    )
  order by t.created_at desc;
$$;

revoke all on function public.discover_teams() from public;
grant execute on function public.discover_teams() to authenticated;

-- ---------------------------------------------------------------------------
-- pending_join_requests(): requests awaiting a decision on teams I own.
-- The team detail page narrows this down to the team being viewed.
-- ---------------------------------------------------------------------------
create or replace function public.pending_join_requests()
returns table (
  id               uuid,
  team_id          uuid,
  user_id          uuid,
  message          text,
  created_at       timestamptz,
  status           text,
  requester_name   text,
  requester_email  text,
  requester_avatar text
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
         p.avatar_url
  from public.team_join_requests r
  join public.profiles p on p.id = r.user_id
  where r.status = 'pending'
    and exists (
      select 1 from public.team_members m
      where m.team_id = r.team_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  order by r.created_at desc;
$$;

revoke all on function public.pending_join_requests() from public;
grant execute on function public.pending_join_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- decide_join_request(): approve or reject a request.
--
-- One transaction does the ownership check, the team_members insert and the
-- status update, so the client never performs a cross-table write. The two
-- branches use untyped string literals rather than casting to a status type,
-- so this function has no dependency on the enum existing.
-- ---------------------------------------------------------------------------
create or replace function public.decide_join_request(
  p_request_id uuid,
  p_decision   text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_user_id uuid;
  v_status  text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision: %', p_decision;
  end if;

  select r.team_id, r.user_id, r.status::text
    into v_team_id, v_user_id, v_status
  from public.team_join_requests r
  where r.id = p_request_id
  for update;

  if v_team_id is null then
    raise exception 'Request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Request already %', v_status;
  end if;

  -- the caller must own the target team
  if not exists (
    select 1 from public.team_members m
    where m.team_id = v_team_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  ) then
    raise exception 'Not authorized for this team';
  end if;

  if p_decision = 'approved' then
    insert into public.team_members (team_id, user_id, role)
    values (v_team_id, v_user_id, 'dev')
    on conflict do nothing;

    update public.team_join_requests
    set status = 'approved', decided_at = now()
    where id = p_request_id;
  else
    update public.team_join_requests
    set status = 'rejected', decided_at = now()
    where id = p_request_id;
  end if;

  return true;
end;
$$;

revoke all on function public.decide_join_request(uuid, text) from public;
grant execute on function public.decide_join_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_join_request(): the requester withdrawing their own request.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_join_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_join_requests
  set status = 'cancelled', decided_at = now()
  where id = p_request_id
    and user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'No pending request with that id';
  end if;

  return true;
end;
$$;

revoke all on function public.cancel_join_request(uuid) from public;
grant execute on function public.cancel_join_request(uuid) to authenticated;

-- ============================================================================
-- VERIFICATION: run these after both parts.
-- ============================================================================

-- 1. No policy anywhere contains a nested select, which is what caused 42P17.
--    Expect 0 rows.
-- select tablename, policyname, qual from pg_policies
--  where schemaname = 'public' and qual like '%select%';

-- 2. All four RPCs exist. Expect 4 rows.
-- select proname from pg_proc
--  where proname in ('discover_teams','pending_join_requests',
--                    'decide_join_request','cancel_join_request');

-- 3. Review every policy on the discovery tables.
-- select tablename, policyname, qual from pg_policies
--  where schemaname = 'public'
--    and tablename in ('teams','team_members','projects','team_join_requests')
--  order by tablename, policyname;

-- 4. Confirm the request you sent is pending and visible as its owner would
--    see it. Expect your row with status 'pending'.
-- select r.id, p.name, p.email, r.status, r.created_at, r.message
-- from public.team_join_requests r
-- join public.profiles p on p.id = r.user_id
-- order by r.created_at desc;