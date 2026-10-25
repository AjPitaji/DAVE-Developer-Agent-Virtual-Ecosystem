# DAVE - Workflow Management App Implementation Plan

## Context

DAVE is a new workflow management application that combines Kanban boards, task lists, and approval/review workflows. The user wants to build a collaborative platform where teams can manage projects with visual boards, track tasks through approval stages, and work together in real-time.

**Why this project:** Create a unified workflow tool that handles both traditional task management (Kanban/lists) and structured approval processes in one place, with team collaboration at its core.

**Visual style:** Playful & vibrant UI (inspired by Asana/ClickUp) with colors, animations, and personality.

**Authentication:** Simple email/password authentication via Supabase Auth.

**Current state:** Empty directory — greenfield project starting from scratch.

---

## Tech Stack

- **Framework:** Next.js 14+ with App Router, TypeScript, Server Components
- **Backend:** Supabase (PostgreSQL database, Auth, Realtime, Row Level Security)
- **Styling:** Tailwind CSS + shadcn/ui component library
- **Drag-and-drop:** @hello-pangea/dnd (maintained fork of react-beautiful-dnd)
- **State management:** Zustand for UI state, Supabase for server state
- **Deployment:** Vercel (recommended for Next.js)

---

## Database Schema

### Core Tables

**profiles** — Extends Supabase `auth.users`
- `id` (uuid, references auth.users)
- `name` (text)
- `avatar_url` (text, nullable)
- `created_at`, `updated_at` (timestamps)

**teams** — Team management
- `id` (uuid, primary key)
- `name` (text)
- `description` (text, nullable)
- `owner_id` (uuid, references profiles)
- `created_at`, `updated_at`

**team_members** — Junction table with roles
- `team_id` (uuid, references teams)
- `user_id` (uuid, references profiles)
- `role` (enum: owner/admin/member)
- Primary key: `(team_id, user_id)`
- **Critical:** Index `user_id` separately (composite PK only indexes first column)

**projects** — Projects within teams
- `id` (uuid, primary key)
- `team_id` (uuid, references teams)
- `name` (text)
- `description` (text, nullable)
- `owner_id` (uuid, references profiles)
- `status` (enum: active/archived/on_hold)
- `created_at`, `updated_at`

**project_members** — Project access control
- `project_id` (uuid, references projects)
- `user_id` (uuid, references profiles)
- `role` (enum: owner/admin/member/viewer)
- Primary key: `(project_id, user_id)`
- **Critical:** Index `user_id` separately

**boards** — Kanban or list boards
- `id` (uuid, primary key)
- `project_id` (uuid, references projects)
- `name` (text)
- `type` (enum: kanban/list)
- `created_at`, `updated_at`

**columns** — Board columns
- `id` (uuid, primary key)
- `board_id` (uuid, references boards)
- `name` (text)
- `position` (integer)
- `color` (text, hex color)
- Index: `(board_id, position)`

**tasks** — Task cards
- `id` (uuid, primary key)
- `column_id` (uuid, references columns)
- `title` (text)
- `description` (text, nullable)
- `assignee_id` (uuid, references profiles, nullable)
- `priority` (enum: low/medium/high/urgent)
- `due_date` (timestamp, nullable)
- `position` (integer)
- `status` (enum: todo/in_progress/done/blocked)
- `created_by` (uuid, references profiles)
- `created_at`, `updated_at`
- Index: `(column_id, position)`

**labels** — Project-scoped labels
- `id` (uuid, primary key)
- `project_id` (uuid, references projects)
- `name` (text)
- `color` (text, hex color)

**task_labels** — Many-to-many junction
- `task_id` (uuid, references tasks)
- `label_id` (uuid, references labels)
- Primary key: `(task_id, label_id)`

**task_comments** — Task discussion
- `id` (uuid, primary key)
- `task_id` (uuid, references tasks)
- `user_id` (uuid, references profiles)
- `content` (text)
- `created_at`, `updated_at`
- Index: `(task_id, created_at)`

**workflows** — Approval workflow definitions
- `id` (uuid, primary key)
- `project_id` (uuid, references projects)
- `name` (text)
- `description` (text, nullable)
- `created_at`, `updated_at`

**workflow_stages** — Sequential approval stages
- `id` (uuid, primary key)
- `workflow_id` (uuid, references workflows)
- `name` (text)
- `position` (integer)
- `approver_role` (enum: owner/admin/member — who can approve at this stage)
- Index: `(workflow_id, position)`

**approval_requests** — Track approval status per task
- `id` (uuid, primary key)
- `task_id` (uuid, references tasks)
- `workflow_stage_id` (uuid, references workflow_stages)
- `reviewer_id` (uuid, references profiles, nullable)
- `status` (enum: pending/approved/rejected/changes_requested)
- `comment` (text, nullable)
- `created_at`, `updated_at`
- Index: `(task_id, workflow_stage_id)`

**notifications** — User notifications
- `id` (uuid, primary key)
- `user_id` (uuid, references profiles)
- `type` (enum: task_assigned/comment_added/approval_requested/approval_completed)
- `title` (text)
- `message` (text)
- `read` (boolean, default false)
- `link` (text, nullable)
- `created_at`
- Index: `(user_id, read, created_at)`

### Row Level Security (RLS)

All tables will have RLS enabled. To avoid recursive policy errors in the multi-tenant setup, use **security definer helper functions**:

```sql
-- Helper function to get user's team IDs (breaks recursion)
create function private.user_team_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select team_id 
  from public.team_members
  where user_id = auth.uid();
$$;
```

This pattern allows policies on `teams` and `projects` to check membership without causing recursive policy evaluation.

### Database Triggers

1. **Auto-create profile on signup** — Trigger on `auth.users` insert creates matching `profiles` row
2. **Auto-add owner to team_members** — Trigger on `teams` insert adds owner as member with role 'owner'
3. **Auto-add owner to project_members** — Trigger on `projects` insert adds owner as member with role 'owner'
4. **Auto-create default columns** — Trigger on `boards` insert creates three columns for kanban: "To Do" (position 0), "In Progress" (position 1), "Done" (position 2)

---

## App Structure

```
C:\Users\ANUJ JHA\projects\DAVE\
├── middleware.ts                       # Auth refresh (CRITICAL)
├── app/
│   ├── layout.tsx                      # Root layout with providers
│   ├── page.tsx                        # Landing page
│   ├── globals.css                     # Tailwind + custom styles
│   ├── (auth)/                         # Auth routes (no navbar)
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   └── (app)/                          # Protected app routes (with sidebar)
│       ├── layout.tsx                  # App shell with nav + sidebar
│       ├── dashboard/page.tsx          # User overview
│       ├── projects/
│       │   ├── page.tsx                # Projects list
│       │   └── [id]/
│       │       ├── page.tsx            # Project detail (boards list)
│       │       ├── board/
│       │       │   └── [boardId]/page.tsx  # Kanban board view
│       │       └── settings/page.tsx   # Project settings
│       ├── teams/
│       │   ├── page.tsx                # Teams list
│       │   └── [id]/page.tsx           # Team detail
│       └── settings/page.tsx           # User settings/profile
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # Browser client (singleton)
│   │   ├── server.ts                   # Server client (per-request)
│   │   └── middleware.ts               # Middleware helper
│   ├── types/
│   │   └── database.ts                 # Generated from Supabase
│   ├── stores/                         # Zustand stores
│   │   ├── ui-store.ts
│   │   └── board-store.ts
│   └── hooks/                          # Custom React hooks
│       ├── use-user.ts
│       └── use-realtime.ts
└── components/
    ├── ui/                             # shadcn/ui components
    ├── auth/
    │   ├── login-form.tsx
    │   └── signup-form.tsx
    ├── layout/
    │   ├── navbar.tsx
    │   ├── sidebar.tsx
    │   └── notification-center.tsx
    ├── boards/
    │   ├── kanban-board.tsx            # CRITICAL: Drag-drop context
    │   ├── kanban-column.tsx           # Droppable column
    │   └── task-card.tsx               # Draggable card
    ├── tasks/
    │   ├── task-detail-dialog.tsx
    │   ├── task-form.tsx
    │   └── comment-list.tsx
    ├── approvals/
    │   ├── workflow-builder.tsx
    │   └── approval-badge.tsx
    └── teams/
        ├── team-card.tsx
        └── member-list.tsx
```

---

## Critical Implementation Details

### 1. Middleware (CRITICAL for Auth)

**File:** `middleware.ts`

The middleware MUST:
- Call `supabase.auth.getUser()` to refresh and verify tokens (NOT `getSession()`)
- Pass refreshed tokens to Server Components via `request.cookies.set`
- Pass refreshed tokens to browser via `response.cookies.set`

**Why:** `getSession()` doesn't verify JWT signatures, allowing session forgery. Always use `getUser()` in protected operations.

### 2. Supabase Clients

**Browser client** (`lib/supabase/client.ts`):
- Singleton pattern
- Created once with `createBrowserClient`
- Used in Client Components

**Server client** (`lib/supabase/server.ts`):
- Created per-request with `createServerClient`
- Cookies helper for reading/writing
- Server Components can't write cookies (middleware does that)

### 3. Kanban Drag-and-Drop

**File:** `components/boards/kanban-board.tsx`

Structure:
- **KanbanBoard** wraps `<DragDropContext>`
- **KanbanColumn** wraps `<Droppable>`
- **TaskCard** wraps `<Draggable>`

**Three drag scenarios:**
1. **Column reordering** — Update `columns.position` for affected columns
2. **Task reordering within column** — Update `tasks.position` within same column
3. **Task moving between columns** — Update `tasks.column_id` + reposition in both source and destination

**Pattern:** Optimistic UI updates first, then persist to database. Revert on error.

### 4. Real-time Subscriptions

Use Supabase Realtime channels to subscribe to:
- Task changes on current board
- New comments on tasks
- Approval status updates
- Notifications for current user

**Pattern:**
```typescript
const channel = supabase
  .channel(`board:${boardId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'tasks',
    filter: `column_id=in.(${columnIds})`
  }, (payload) => {
    // Invalidate cache and refetch
  })
  .subscribe()

// Clean up on unmount
return () => { channel.unsubscribe() }
```

---

## Implementation Phases

### Phase 1: Project Scaffolding (Days 1-2)
1. Initialize Next.js with TypeScript: `npx create-next-app@latest DAVE --typescript --tailwind --app`
2. Install dependencies: `@supabase/supabase-js`, `@supabase/ssr`, `@hello-pangea/dnd`, `zustand`, `date-fns`, `lucide-react`
3. Set up Supabase project at supabase.com
4. Create database schema via migration SQL file: `supabase/migrations/20241001000000_initial_schema.sql`
5. Generate TypeScript types: `supabase gen types typescript`
6. Configure middleware for auth refresh
7. Set up shadcn/ui: `npx shadcn-ui@latest init`

**Files created:**
- `middleware.ts`
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`
- `lib/types/database.ts`
- `supabase/migrations/20241001000000_initial_schema.sql`

### Phase 2: Authentication (Days 3-4)
1. Build signup form with email/password
2. Build login form
3. Implement auth flows (signup, login, logout)
4. Protected route checks in `(app)` layout
5. User profile page

**Files created:**
- `app/(auth)/login/page.tsx`
- `app/(auth)/signup/page.tsx`
- `components/auth/login-form.tsx`
- `components/auth/signup-form.tsx`
- `lib/hooks/use-user.ts`

**Verification:** Sign up → log in → access dashboard → log out → redirected to login

### Phase 3: Teams & Projects (Days 5-7)
1. Teams CRUD operations
2. Team membership management (invite, remove, change roles)
3. Projects CRUD within teams
4. Project membership management
5. Dashboard page showing user's teams and projects

**Files created:**
- `app/(app)/dashboard/page.tsx`
- `app/(app)/teams/page.tsx`
- `app/(app)/teams/[id]/page.tsx`
- `app/(app)/projects/page.tsx`
- `app/(app)/projects/[id]/page.tsx`
- `components/teams/team-card.tsx`
- `components/teams/member-list.tsx`

**Verification:** Create team → add members → create project → view project list

### Phase 4: Boards & Kanban (Days 8-12)
1. Create board within project
2. Kanban board component with `@hello-pangea/dnd`
3. Drag-and-drop for columns and tasks
4. Task creation dialog
5. Position updates in database
6. Column management (add, rename, delete, reorder)

**Files created:**
- `app/(app)/projects/[id]/board/[boardId]/page.tsx` (CRITICAL)
- `components/boards/kanban-board.tsx` (CRITICAL)
- `components/boards/kanban-column.tsx`
- `components/boards/task-card.tsx`
- `components/tasks/task-form.tsx`
- `lib/stores/board-store.ts`

**Verification:** Create board → drag tasks between columns → drag to reorder → refresh page (positions persist)

### Phase 5: Task Details (Days 13-15)
1. Task detail dialog with full information
2. Rich description field (textarea with markdown preview optional)
3. Comments system with real-time updates
4. Assignee selection dropdown
5. Label management (create, assign, remove)
6. Task editing and deletion

**Files created:**
- `components/tasks/task-detail-dialog.tsx`
- `components/tasks/comment-list.tsx`
- `components/tasks/label-picker.tsx`
- `lib/hooks/use-realtime.ts`

**Verification:** Click task → edit fields → add comment → assign to user → add labels → see updates in real-time (open same task in two browsers)

### Phase 6: Approval Workflows (Days 16-18)
1. Workflow definition UI (create workflow with stages)
2. Assign workflow to a task
3. Approval request creation when task enters workflow
4. Approve/reject/request changes actions
5. Approval status badges on task cards
6. Workflow progress indicator

**Files created:**
- `app/(app)/projects/[id]/settings/page.tsx` (workflow tab)
- `components/approvals/workflow-builder.tsx`
- `components/approvals/approval-badge.tsx`
- `components/approvals/approval-panel.tsx`

**Verification:** Create workflow with 2 stages → assign to task → first approver approves → second approver sees pending → approves → task marked complete

### Phase 7: Real-time & Notifications (Days 19-21)
1. Realtime subscriptions for board updates
2. Notification system (database table + triggers)
3. Notification center in navbar with unread count
4. Mark notifications as read
5. Notification triggers for: task assigned, comment added, approval requested, approval completed

**Files created:**
- `components/layout/notification-center.tsx`
- `lib/hooks/use-notifications.ts`
- `supabase/migrations/20241002000000_notifications.sql`

**Verification:** User A assigns task to User B → User B sees notification badge → clicks to see notification → marks as read → badge updates

### Phase 8: Polish & Deploy (Days 22-25)
1. Responsive design for mobile and tablet
2. Loading states with skeletons
3. Error boundaries and error handling
4. Empty states (no projects, no tasks, etc.)
5. Performance optimization (code splitting, image optimization)
6. Test all features end-to-end
7. Deploy to Vercel
8. Write README.md

**Files created:**
- `components/ui/skeleton.tsx`
- `components/ui/empty-state.tsx`
- `app/error.tsx`
- `README.md`

**Verification:** Full walkthrough — signup → create team → create project → create board → add tasks → drag tasks → approve tasks → check notifications → test on mobile

---

## Verification Strategy

### After Each Phase
- **Phase 2 (Auth):** Sign up, log in, access protected route, log out
- **Phase 3 (Teams/Projects):** Create team, add member, create project, verify RLS (user can't see other team's projects)
- **Phase 4 (Boards):** Drag task, refresh page (position persists), open in two browsers (both see updates)
- **Phase 5 (Task Details):** Add comment, see real-time update in second browser
- **Phase 6 (Approvals):** Multi-stage approval flow with two approvers
- **Phase 7 (Notifications):** Trigger notification, see badge, mark as read
- **Phase 8 (Polish):** Full end-to-end test on desktop, tablet, and mobile

### Final End-to-End Test
1. User A signs up
2. User A creates team "Engineering"
3. User A invites User B to team
4. User A creates project "Q1 Launch"
5. User A creates board "Sprint 1"
6. User A creates task "Design API"
7. User A assigns task to User B
8. User B logs in, sees notification
9. User B moves task to "In Progress"
10. User A sees real-time update
11. User B completes task, moves to approval workflow
12. User A approves task
13. Task marked as complete

---

## Security Checklist

- [ ] RLS enabled on all tables
- [ ] Security definer functions for helper queries
- [ ] Indexes on all foreign keys and RLS filter columns
- [ ] Middleware uses `getUser()` not `getSession()`
- [ ] Protected routes redirect unauthenticated users
- [ ] Input validation on all forms (client + server)
- [ ] XSS protection (React escaping)
- [ ] SQL injection protection (Supabase client parameterization)

---

## Performance Checklist

- [ ] Composite indexes on `(column_id, position)` and `(task_id, created_at)`
- [ ] Index `user_id` on junction tables (`team_members`, `project_members`, `task_labels`)
- [ ] Server Components for initial page loads
- [ ] Client Components only where interactivity needed
- [ ] Optimistic updates for drag-and-drop
- [ ] Code splitting with dynamic imports for heavy components
- [ ] Image optimization with Next.js `<Image>`

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@supabase/supabase-js": "^2.38.0",
    "@supabase/ssr": "^0.0.10",
    "@hello-pangea/dnd": "^16.5.0",
    "zustand": "^4.4.0",
    "date-fns": "^2.30.0",
    "lucide-react": "^0.294.0",
    "tailwind-merge": "^2.0.0",
    "clsx": "^2.0.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-popover": "^1.0.7",
    "@radix-ui/react-avatar": "^1.0.4",
    "@radix-ui/react-badge": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "@types/node": "^20.8.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

---

## Estimated Timeline

**Total: ~25 days (5 weeks) for MVP**

- Phase 1 (Scaffolding): 2 days
- Phase 2 (Auth): 2 days
- Phase 3 (Teams/Projects): 3 days
- Phase 4 (Boards/Kanban): 5 days ← Most complex
- Phase 5 (Task Details): 3 days
- Phase 6 (Approvals): 3 days
- Phase 7 (Real-time/Notifications): 3 days
- Phase 8 (Polish/Deploy): 4 days

---

## Critical Files Reference

These files are the architectural cornerstones:

1. `middleware.ts` — Auth token refresh (MUST use `getUser()`)
2. `lib/supabase/server.ts` — Server-side Supabase client
3. `supabase/migrations/20241001000000_initial_schema.sql` — Database schema with RLS
4. `components/boards/kanban-board.tsx` — Drag-and-drop logic
5. `app/(app)/projects/[id]/board/[boardId]/page.tsx` — Board page with real-time

---

## Notes

- This is a greenfield project starting from an empty directory
- Focus on getting core features working first, polish later
- Real-time updates are essential for collaboration — prioritize Realtime subscriptions
- RLS security is critical — test with multiple users to verify permissions
- Drag-and-drop UX must feel instant — optimistic updates are mandatory
- The playful/vibrant UI style means: colorful labels, smooth animations, friendly empty states, personality in copy