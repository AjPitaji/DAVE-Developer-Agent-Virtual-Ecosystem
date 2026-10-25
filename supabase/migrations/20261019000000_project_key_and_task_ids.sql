-- ============================================================================
-- DAVE - Project keys, task IDs, and PR linkage
--
-- Three changes:
--   1. `projects.key` (e.g. "DV") + `projects.next_task_number` counter.
--      `key` is the short prefix the user picks (or Jim suggests) when
--      initializing the project; the counter feeds `tasks.display_id`.
--   2. `tasks.display_id` (e.g. "DV-1") + PR columns (pr_url, pr_number,
--      pr_branch). Display ID is the user-facing identifier, populated
--      by a BEFORE INSERT trigger that reads the project's key, locks the
--      project row, and increments the counter.
--   3. Project with no key set: display_id stays null. The UI handles
--      nulls gracefully (no chip), and Jim can set the key later.
--      Existing tasks are NOT backfilled here — that's a one-shot step
--      the operator can run manually if they want.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Project columns
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists key text
    check (key is null or (length(key) between 2 and 4 and key = upper(key) and key ~ '^[A-Z0-9]+$'));

alter table public.projects
  add column if not exists next_task_number int not null default 1
    check (next_task_number > 0);

-- ---------------------------------------------------------------------------
-- 2. Task columns
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists display_id text;

alter table public.tasks
  add column if not exists pr_url text;

alter table public.tasks
  add column if not exists pr_number int
    check (pr_number is null or pr_number > 0);

alter table public.tasks
  add column if not exists pr_branch text;

-- The display_id is unique per project, never per database. A regular
-- unique index on (project_id, display_id) gives us that, while still
-- allowing the same display_id to be reused across different projects.
create unique index if not exists uq_tasks_project_display_id
  on public.tasks(
    (
      select b.project_id
      from public.columns c
      join public.boards b on b.id = c.board_id
      where c.id = tasks.column_id
    ),
    display_id
  )
  where display_id is not null;

-- ---------------------------------------------------------------------------
-- 3. BEFORE INSERT trigger — sets tasks.display_id from the project's
--    key and atomically bumps projects.next_task_number. The project row
--    is locked with FOR UPDATE so two parallel INSERTs can't grab the
--    same number.
-- ---------------------------------------------------------------------------
create or replace function public.set_task_display_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_key        text;
  v_num        int;
begin
  -- Walk the column -> board -> project chain to find the project + key.
  select b.project_id, p.key
    into v_project_id, v_key
  from public.columns c
  join public.boards   b on b.id = c.board_id
  join public.projects p on p.id = b.project_id
  where c.id = NEW.column_id;

  if v_project_id is null then
    raise exception 'Column % does not belong to any project', NEW.column_id;
  end if;

  -- If the project has no key yet, leave display_id null. The UI shows
  -- a banner asking the user to set a key in Jim before creating tasks.
  if v_key is null or v_key = '' then
    return NEW;
  end if;

  -- Lock the project row so concurrent inserts get distinct numbers.
  select next_task_number into v_num
  from public.projects
  where id = v_project_id
  for update;

  NEW.display_id := v_key || '-' || v_num::text;

  update public.projects
  set next_task_number = next_task_number + 1
  where id = v_project_id;

  return NEW;
end;
$$;

drop trigger if exists task_display_id_trigger on public.tasks;
create trigger task_display_id_trigger
  before insert on public.tasks
  for each row execute function public.set_task_display_id();