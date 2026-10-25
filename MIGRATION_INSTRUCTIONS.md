# Applying the Database Migration to Supabase

## Pending Migrations

These still need to be run in the Supabase SQL Editor (Dashboard → your project
→ **SQL Editor** → New Query → paste → Run):

| File | What it does |
| --- | --- |
| `supabase/migrations/20261026000000_linkedin_specialization.sql` | Adds `profiles.specialization` and recreates `pending_join_requests()` so it returns the requester's specialization. |
| `supabase/migrations/20261027000000_remove_linkedin.sql` | Drops the `linkedin_*` columns from `profiles` and recreates `pending_join_requests()` without them. |

Without the second file the team page will show an error when it loads pending
join requests, because the client expects the new columns on the RPC.

---

The RLS policy error you're seeing (`new row violates row-level security policy for table "teams"`) occurs because the database schema and RLS policies haven't been applied to your Supabase project yet.

## Option 1: Apply via Supabase Dashboard (Recommended)

1. **Open the Supabase SQL Editor:**
   - Go to https://supabase.com/dashboard
   - Select your project (vugzkbjuhuxyalxdyorm)
   - Click "SQL Editor" in the left sidebar

2. **Run the Migration:**
   - Click "New Query"
   - Copy the **entire contents** of `supabase/migrations/20261003000000_initial_schema.sql`
   - Paste it into the SQL editor
   - Click "Run" (or press Ctrl+Enter)

3. **Verify:**
   - Check that no errors appear in the output
   - Go to "Table Editor" and verify tables like `profiles`, `teams`, `projects`, etc. exist
   - Go to "Authentication" → "Policies" to verify RLS policies were created

## Option 2: Using Supabase CLI (Requires Local Setup)

If you want to use the CLI in the future:

```powershell
# Install Supabase CLI globally
npm install -g supabase

# Link your project (you'll need your project ref and database password)
npx supabase link --project-ref vugzkbjuhuxyalxdyorm

# Push the migration
npx supabase db push
```

## What the Migration Does

The migration sets up:

1. **Tables:** profiles, teams, team_members, projects, project_members, boards, columns, tasks, labels, workflows, approvals, notifications
2. **Security-Definer Functions:** Helper functions that bypass RLS for internal operations:
   - `private.user_team_ids()` - Returns teams the current user belongs to
   - `private.user_project_ids()` - Returns projects the current user has access to
3. **Triggers:**
   - `handle_new_user()` - Auto-creates profile when user signs up
   - `handle_new_team()` - Auto-adds team creator as owner (bypasses RLS with security definer)
   - `handle_new_project()` - Auto-adds project creator as owner
   - `handle_new_board()` - Auto-creates default columns for Kanban boards
4. **RLS Policies:** Row-level security ensuring users can only access their own teams/projects

## The Specific Issue

The `handle_new_team()` trigger runs with `security definer` privileges, which means it bypasses RLS policies when inserting the first owner into `team_members`. Without this trigger, the circular dependency causes the error:

- Creating a team requires being authenticated ✓
- After creating the team, the trigger tries to add you as owner
- But `tm_insert_owner` policy requires you to already be an owner
- The `security definer` on the trigger solves this by bypassing RLS

## After Applying the Migration

Once the migration is applied successfully:

1. The app will work as designed
2. Users can create teams without RLS violations
3. Teams automatically get their creator as the first owner
4. Projects automatically get their creator as the first member
5. Boards automatically get default Kanban columns (To Do, In Progress, Done)

## Troubleshooting

If you see errors when running the migration:

- **"relation already exists"**: Some tables might already exist. The migration uses `create table if not exists`, so this is usually safe to ignore.
- **"type already exists"**: Same as above, the migration handles this with `do $$ begin ... exception when duplicate_object then null; end $$;`
- **Permission errors**: Make sure you're running the SQL as the database owner (your Supabase project's service role)

## Next Steps

After successfully applying the migration:

1. Try creating a team from the DAVE app
2. The team should be created successfully
3. You should automatically be added as the team owner
4. You can then create projects under that team
