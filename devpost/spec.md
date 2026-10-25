---
doc: spec
status: approved
---

# DAVE — Technical Spec

## How This Works, In Plain Language

DAVE is a Next.js web app. The browser shows pages (login, project setup, team builder, Kanban board) rendered by React. When data needs to be saved or AI agents need to run, the browser calls Next.js API routes running on the same server. Those routes talk to Supabase (a hosted Postgres database) for storing projects, tasks, and team members, and to the OpenAI API for AI agent reasoning. GitHub integration happens server-side through the GitHub REST API using a stored token — Jim creates branches and PRs, Pam searches public repos, Michael reads the repo's file tree to plan tasks. The reviewer agent (Dwight) takes a task's display ID, finds the linked PR, and reviews the committed code rather than browsing a live site. Everything runs locally with `npm run dev`; the demo is recorded from the browser.

## The Core Journey Through the System

PRD ref: `prd.md > The Core Journey`.

1. User opens the app in a browser → Next.js serves the login page.
2. User logs in with email/password (Supabase Auth) → role selection screen appears.
3. Project Owner creates a project (name, timeline, capacity, GitHub repo URL) → saved to Supabase `projects` table.
4. Team builder screen → Owner picks human teammates → saved to `team_members` table. AI teammates (Michael, Jim, Dwight) are seeded automatically.
5. Workspace loads → Kanban board reads tasks from Supabase, grouped into Ready/In Progress/Blocked/Done columns.
6. Michael reads the linked GitHub repo's file tree via GitHub API and proposes tasks grounded in real file paths → tasks inserted into Supabase.
7. Jim takes a task, creates a branch and PR via GitHub API → branch name and PR URL stored on the task record.
8. Task moves to Done → Dwight reviews the committed code from the linked PR → review report stored and shown in Review Report View.
9. Pam answers "has anyone built this?" by searching public GitHub repos → results shown inline.

## Stack

- **Next.js 16** (App Router) — frontend + API routes in one process. Docs: https://nextjs.org/docs
- **React 19** — UI components. Docs: https://react.dev
- **TypeScript 5** — type safety. Docs: https://www.typescriptlang.org/docs
- **Tailwind CSS 4** — styling. Docs: https://tailwindcss.com/docs
- **Supabase** (Postgres + Auth) — data persistence and authentication. Docs: https://supabase.com/docs
- **OpenAI API** — AI agent reasoning (Michael, Jim, Dwight, Pam). Docs: https://platform.openai.com/docs
- **GitHub REST API** — repo reading, branch/PR creation, public search. Docs: https://docs.github.com/en/rest
- **Radix UI** — accessible component primitives (dialogs, dropdowns, selects). Docs: https://www.radix-ui.com/docs/primitives
- **Zustand** — client-side state. Docs: https://zustand.docs.pmnd.rs
- **@hello-pangea/dnd** — drag-and-drop for Kanban. Docs: https://github.com/hello-pangea/dnd
- **cheerio** — HTML parsing for repo content extraction. Docs: https://cheerio.js.org/docs
- **lucide-react** — icons. Docs: https://lucide.dev/docs

Rationale: single-process Next.js keeps local dev simple. Supabase handles both auth and data with minimal setup. OpenAI is the LLM provider already wired in. GitHub API is real (not mocked) per learner decision.

## Where It Runs and How Someone Tries It

- **Runtime:** local Node.js process via `npm run dev`, browser at `http://localhost:3000`.
- **Requirements:** Node.js 20+, `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`.
- **Start command:** `npm run dev`
- **Demo recording:** open browser, walk through login → project creation → team builder → Kanban → task execution → review report. Record with any screen recorder.
- **Deployment:** none for POC. Optional later.

## Look and Feel

Carried from `prd.md > Look and Feel` and `scope.md > Inspiration & Identity`:
- Modern development-tool aesthetic. Fast, developer-centric.
- Clear stage visibility — 4 columns with distinct headers.
- Live agent activity indicators (idle/working/PR raised/awaiting review).
- Structured test/review reports with pass/fail per item.
- Light/dark theme support via Tailwind.
- Radix UI primitives for accessible interactions.

## Components

### Auth (Login / Role Selection)
Login with email/password via Supabase Auth. Role selection: Project Owner or Developer.
PRD ref: `prd.md > Authentication & Role Selection`.

### Project Setup
Form: project name, timeline/capacity estimates, GitHub repo URL. Validates required fields.
PRD ref: `prd.md > Project Creation`.

### Team Builder
Select human teammates with role labels. AI teammates seeded automatically.
PRD ref: `prd.md > Team Builder`.

### Kanban Board
4 columns: Ready, In Progress, Blocked, Done. Task cards with title, assignee, stage. Drag-and-drop via @hello-pangea/dnd.
PRD ref: `prd.md > 4-Stage Kanban Board`.

### AI Task Planner (Michael)
Reads project description, team, and linked GitHub repo (file tree + key file contents). Proposes tasks naming real file paths. Accepts extra instructions saved with project. Degrades honestly if repo unreadable.
PRD ref: `prd.md > AI Task Planner (Michael)`.

### Pam — Prior Art Search
Turns a technical question into GitHub search queries. Searches public repos. Returns matches with stars, language, topics, one-line relevance. Honest when no matches.
PRD ref: `prd.md > Pam — Prior Art Search`.

### AI Developer (Jim)
Creates a dedicated branch, writes code, raises a PR via GitHub API. Branch name and PR link stored on task. Execution status tracked.
PRD ref: `prd.md > AI Teammate Task Execution`.

### Reviewer Agent (Dwight)
Reviews committed code from a PR linked to a task (by task display ID or PR URL). Produces structured review report: pass/fail per item, feedback, details. No live browser browsing.
PRD ref: `prd.md > Reviewer Agent Progression Testing`.

### Review Report View
Displays Dwight's structured review report. Project Owner accesses from workspace.
PRD ref: `prd.md > Reviewer Agent Progression Testing`.

### GitHub Integration (lib/github/)
Server-side GitHub REST API client. Repo tree reading, branch creation, PR creation, public search. Uses stored GITHUB_TOKEN.
PRD ref: `prd.md > AI Teammate Task Execution`, `prd.md > Pam — Prior Art Search`.

## Data Model

Supabase Postgres tables:

- **projects** — id, name, timeline, capacity, github_repo_url, extra_instructions, owner_id, created_at
- **team_members** — id, project_id, name, role, is_ai (boolean), ai_persona (michael/jim/dwight), created_at
- **tasks** — id, project_id, title, description, stage (ready/in_progress/blocked/done), assignee_id, branch_name, pr_url, pr_status, display_id, created_at, updated_at
- **review_reports** — id, task_id, pr_url, results (JSON), feedback, created_at

State: tasks are the source of truth in Supabase. Client reads via API routes. Zustand holds transient UI state (selected task, drag state). On navigation, tasks re-fetch from Supabase.

## File Structure

```
dave-app/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/page.tsx
│   ├── projects/
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx          # Main workspace (Kanban)
│   ├── teams/
│   │   ├── new/page.tsx
│   │   ├── [id]/page.tsx
│   │   └── discover/page.tsx
│   ├── settings/page.tsx
│   ├── layout.tsx
│   └── api/
│       ├── auth/...
│       ├── projects/[id]/...
│       ├── jim/[projectId]/route.ts
│       ├── michael/[projectId]/route.ts
│       ├── dwight/[projectId]/route.ts
│       └── pam/route.ts
├── components/
│   ├── KanbanBoard.tsx
│   ├── TaskCard.tsx
│   ├── JimPanel.tsx
│   ├── DwightPanel.tsx
│   ├── MichaelPanel.tsx
│   ├── PamPanel.tsx
│   └── ...
├── lib/
│   ├── agents/
│   │   ├── michael.ts
│   │   ├── jim.ts
│   │   ├── dwight.ts
│   │   ├── pam.ts
│   │   └── client.ts
│   ├── github/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   ├── repo.ts
│   │   └── search.ts
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   └── types/
│       └── database.ts
├── devpost/
├── package.json
└── .env.local
```

## External Services and Dependencies

- **Supabase:** Auth + Postgres. Requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Free tier sufficient. Docs: https://supabase.com/docs
- **OpenAI API:** Agent reasoning. Requires `OPENAI_API_KEY`. Model: gpt-4o-mini (cost-efficient for POC). Docs: https://platform.openai.com/docs
- **GitHub REST API:** Repo tree, branches, PRs, search. Requires `GITHUB_TOKEN` (personal access token with repo scope). Rate limit: 5000 req/hr authenticated. Docs: https://docs.github.com/en/rest

## Important Failure Modes

- **GitHub token missing/invalid** → AI agents that need repo access (Michael, Jim, Pam) fail gracefully with an error message; non-GitHub features still work.
- **OpenAI API unavailable** → agent endpoints return error; UI shows "agent unavailable" state.
- **Supabase connection failure** → app shows error state; no data loads. Local dev requires Supabase running or cloud project configured.
- **Empty repo / no file tree** → Michael reports "could not read repository" instead of inventing files.

## What Was Simplified and Why

- **Reviewer agent reviews committed code** instead of running live Playwright browser tests — real browser automation is deferred to "Later" per scope; code review by task/PR link proves the concept without cloud browser infra.
- **GitHub integration uses personal access token** instead of full OAuth flow — OAuth + webhooks deferred to "Later"; PAT is sufficient for POC demo.
- **Single-user demo** — multi-user real-time collaboration deferred; POC demonstrates one user's flow.
- **Mock reviewer test results** where real test execution isn't feasible — seeded realistic data behind the review trigger, labeled as simulated.

## Decisions and Open Issues

### Decisions
- **Stack:** Next.js + Supabase + OpenAI + GitHub API (learner's existing setup, confirmed).
- **Runtime:** local dev, recorded video demo (learner choice).
- **Data persistence:** Supabase (learner confirmed).
- **GitHub integration:** real API calls with PAT (learner confirmed — tools already built on GitHub API).
- **AI provider:** OpenAI (already in dependencies).
- **Reviewer agent:** reviews committed code by task display ID / PR link, not live browser (learner clarified).

### One Useful Unknown
- **Question:** How does the reviewer agent know which code to review? **Resolved:** It reviews the PR linked to a task (by task display ID or PR URL provided). No live browser browsing needed.

### Open Issues (carried from PRD)
- Task assignment mechanism (drag-and-drop vs dropdown) — TBD during build.
- Task creation flow (manual vs import) — TBD during build.
- Developer role workflow details — TBD during build.
- Review report detail level — TBD during build.
- Visual design specifics — TBD during build.
- Data persistence strategy confirmed as Supabase (resolved).
