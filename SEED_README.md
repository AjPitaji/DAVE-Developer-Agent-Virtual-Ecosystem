# Mock Developer Seed (DAVE — dev only)

3 fake developer accounts seed karne ka script, taaki bina real email ke banae
team-add / assign-task / discover flow end-to-end test ho sake.

## Quick start

1. Open Supabase Dashboard → **SQL Editor**
2. Paste contents of `supabase/seed.sql` (v2, ON-CONFLICT-free)
3. Click **Run**
4. Confirm 3 rows returned by the sanity `select` at the bottom of the file

> **Hit error `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`** with v1? That's already fixed in v2 — it uses explicit `IF EXISTS → UPDATE / ELSE INSERT` branching instead of `ON CONFLICT`. Just re-paste the new `seed.sql` and run.

## What you get

| Email | Password | Name |
|---|---|---|
| `aarav@dave.test` | `dev123` | Aarav |
| `priya@dave.test` | `dev123` | Priya |
| `karthik@dave.test` | `dev123` | Karthik |

Har ek ka `auth.users` + `auth.identities` + `public.profiles` row ban jayega,
avatar DiceBear se auto-generated.

## How to use in the app

1. `npm run dev`
2. Apne real account se login kar (apna hi Supabase user)
3. `/teams/new` se ek team bana
4. `/teams/[id]` → **Add Member Drawer** me paste kar: `aarav@dave.test`
5. `profile_by_email` RPC resolve karke add kar dega
6. Same Priya aur Karthik ke liye repeat kar
7. Ab `/projects/new` se project bana → task assign kar mock devs ko

## Login as a mock dev

Incognito window khol → `/login` → `aarav@dave.test` / `dev123` → dashboard.
Multi-window testing ke liye 3 incognito windows me 3 devs login kar sakta hai.

## Re-run / cleanup

- **Re-run**: script idempotent hai, multiple baar paste kar sakta hai (`on conflict` safe).
- **Reset**: Supabase SQL editor me —
  ```sql
  delete from public.profiles where email like '%@dave.test';
  delete from auth.identities where provider_id like '%@dave.test';
  delete from auth.users where email like '%@dave.test';
  ```

## When NOT to use this

- Production / staging-with-real-data: skip. `.test` emails are RFC-reserved
  but hosted Supabase project will let them exist after direct SQL insert.
  Anyone using these credentials has no real security boundary.
- Hackathon demo: ✅ perfect fit.
- Local-only dev: ✅.
