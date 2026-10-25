---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [ ] **1. App boots and core journey runs end to end**
  Becomes usable: Login → role selection → project creation → team builder → Kanban workspace, all loading without errors.
  Why now: Proves the scaffold and data layer work before adding agent complexity.
  PRD ref: `prd.md > The Core Journey` (steps 1-4)
  Spec ref: `spec.md > Components`, `spec.md > Where It Runs and How Someone Tries It`
  Build: Verify dev server starts, Supabase connection works, and the core journey (login → project → team → board) runs without errors. Fix any boot-time issues.
  Verify (mechanical): `npm run dev` starts; browser loads login page; can create project and reach Kanban board.
  Learner check: Open the app, log in, create a project, and confirm the Kanban board appears.
  Commit: `Verify app boots and core journey runs`

- [ ] **2. Michael plans tasks from the GitHub repo**
  Becomes usable: Michael reads the linked repo's file tree and proposes tasks grounded in real file paths.
  Why now: AI task planning is the unique kernel — proves the agent can reason over real repo data.
  PRD ref: `prd.md > AI Task Planner (Michael)`
  Spec ref: `spec.md > Components` (Michael), `spec.md > External Services and Dependencies` (GitHub)
  Build: Verify Michael's API route calls GitHub repo tree API, feeds it to OpenAI, and returns tasks with real file paths. Fix any issues.
  Verify (mechanical): Trigger Michael on a project with a GitHub repo; confirm response contains task titles referencing real file paths.
  Learner check: Ask Michael to plan tasks for a project and check that proposed tasks name actual files from the repo.
  Commit: `Verify Michael AI task planner`

- [ ] **3. Jim creates a branch and PR**
  Becomes usable: Jim creates a dedicated branch and raises a PR via GitHub API; branch name and PR link stored on the task.
  Why now: Branch/PR creation is the developer-agent kernel — proves code can be pushed programmatically.
  PRD ref: `prd.md > AI Teammate Task Execution`
  Spec ref: `spec.md > Components` (Jim), `spec.md > External Services and Dependencies` (GitHub)
  Build: Verify Jim's API route creates a branch, commits code, and opens a PR. Confirm branch_name and pr_url are stored on the task record.
  Verify (mechanical): Trigger Jim on a task; confirm a real PR URL is returned and stored.
  Learner check: Trigger Jim on a task and confirm the branch name and PR link appear on the task card.
  Commit: `Verify Jim branch and PR creation`

- [ ] **4. Pam searches public GitHub**
  Becomes usable: Pam turns a question into GitHub search queries and returns relevant public repos with one-line relevance.
  Why now: Prior-art search is a standalone feature that proves external API integration.
  PRD ref: `prd.md > Pam — Prior Art Search`
  Spec ref: `spec.md > Components` (Pam), `spec.md > External Services and Dependencies` (GitHub)
  Build: Verify Pam's API route searches public GitHub repos and returns results with stars, language, and relevance reason.
  Verify (mechanical): Ask Pam a question; confirm results include real GitHub repo links.
  Learner check: Ask Pam "has anyone built a kanban board?" and confirm real repos appear with relevance explanations.
  Commit: `Verify Pam prior art search`

- [ ] **5. Dwight reviews committed PR code**
  Becomes usable: Dwight reviews the PR linked to a task (by display ID or PR URL) and produces a structured review report.
  Why now: Reviewer agent is the QA kernel — proves code review can be automated.
  PRD ref: `prd.md > Reviewer Agent Progression Testing`
  Spec ref: `spec.md > Components` (Dwight), `spec.md > Important Failure Modes`
  Build: Verify Dwight's API route fetches PR diff/commits, sends to OpenAI for review, and stores a structured report. Confirm it works with task display ID or PR URL.
  Verify (mechanical): Trigger Dwight on a task with a linked PR; confirm a review report with pass/fail items is returned.
  Learner check: Trigger Dwight on a completed task and confirm the review report displays test results and feedback.
  Commit: `Verify Dwight PR code review`

- [ ] **6. Kanban board interactions work**
  Becomes usable: Tasks can be moved between Ready/In Progress/Blocked/Done columns; cards show title, assignee, stage.
  Why now: The board is the central workspace UI — must work for the demo.
  PRD ref: `prd.md > 4-Stage Kanban Board`
  Spec ref: `spec.md > Components` (Kanban Board), `spec.md > Data Model`
  Build: Verify drag-and-drop or button-based stage transitions persist to Supabase. Confirm task cards display correctly.
  Verify (mechanical): Move a task between columns; reload page; confirm it stays in new column.
  Learner check: Drag a task from Ready to In Progress and confirm it stays there after refresh.
  Commit: `Verify Kanban board interactions`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after slice 1
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: 
Route and stops: 
Edit outcome: 
Reflection: 
Activity mode: 

## Revisions

<!-- Leave empty initially -->
