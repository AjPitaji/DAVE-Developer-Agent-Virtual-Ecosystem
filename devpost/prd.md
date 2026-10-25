---
doc: prd
status: approved
---

# DAVE — Product Requirements

An agile workflow platform where human teammates work the same board as three built-in AI teammates, with automated branch/PR workflows and autonomous QA progression testing.

Source: `scope.md > The Unique Kernel`, `scope.md > The Core Loop`

## The Core Journey

1. **Login & Role Selection**: User authenticates with email/password, then chooses to be a Project Owner or a Developer.
2. **Project Setup** (Project Owner path): User creates a new project and provides project details (timeline, capacity estimates, GitHub repo connection).
3. **Team Assembly**: Project owner selects human teammates; the three AI teammates (Michael, Jim, Dwight) are present in the workspace from the start.
4. **Start Project Workspace**: Project launches into the main workspace with the 4-stage Kanban board.
5. **Task Execution Loop**:
   - Tasks move through `Ready` → `In Progress` → `Blocked` → `Done`.
   - AI teammates work in branches and raise PRs.
   - Branch and PR artifacts are viewable.
6. **Progression Review**: Reviewer agent runs feature progression tests (Playwright/Cypress-style) and delivers structured review reports to the project owner.

## Screens and Layout

1. **Login Screen**: Email and password authentication.
2. **Role Selection Screen**: Choose "Project Owner" or "Developer".
3. **Project Setup Screen** (Project Owner): Form for project details—name, timeline/capacity estimates, GitHub repo URL.
4. **Team Builder Screen**: Interface to select human teammates with role assignments.
5. **Main Workspace**: 4-column Kanban board (`Ready`, `In Progress`, `Blocked`, `Done`) with task cards, live agent activity, and access to PR/branch views.
6. **PR/Branch Detail View**: Display of the AI teammate's generated branch name, PR link, and status.
7. **Review Report View**: Structured test feedback from the Reviewer agent with progression test results.

## Look and Feel

*To be established during build iteration.* Initial direction from `scope.md > Inspiration & Identity`:
- Fast, developer-centric agile workspace
- Clear stage visibility
- Live agent activity indicators
- Structured test/review reports

Visual style: Modern development tool aesthetic with support for light/dark themes.

## Features and Behavior

### Authentication & Role Selection

- User logs in with email and password.
- After authentication, user selects role: **Project Owner** or **Developer**.
  - Project Owner: can create projects, configure teams, view all tasks and reviews.
  - Developer: joins projects, views tasks assigned to them.

### Project Creation (Project Owner)

- Project Owner creates a new project by providing:
  - Project name
  - Timeline and capacity estimates (days to complete, deadlines)
  - GitHub repository URL (empty repo expected)
- Project setup form validates required fields before allowing progression to team setup.

### Team Builder

- Project Owner selects **human teammates** (list or invite interface, details TBD during build).
- Team roster displays selected members with role labels.
- Acceptance Criteria:
  - [ ] Project Owner can add at least one human teammate to a team
  - [ ] Each team member shows their assigned role
  - [ ] Team configuration can be saved before starting the project

### AI Task Planner (Michael)

- Michael reads the project description, the team, and the linked GitHub repository — the file tree plus the contents of the highest-signal files.
- Every proposed task names the real files it touches, and matches the stack and folder layout that already exists.
- The team can add extra instructions ("focus on the landing page first", "split the backend work into smaller tasks") that Michael follows on top of his defaults. They are saved with the project.
- When the repository cannot be read, Michael says so instead of inventing files.
- Acceptance Criteria:
  - [ ] Michael's proposals reference actual file paths from the repository
  - [ ] Extra instructions persist with the project and visibly change the plan
  - [ ] An unreadable repository degrades honestly rather than producing invented detail

### Pam — Prior Art Search

- Any teammate can ask Pam a technical question ("has anyone built a self-hosted kanban board with realtime collaboration?").
- Pam turns the question into GitHub search queries and searches **public** GitHub — repositories, and code when the team has connected GitHub.
- She returns the closest matches, each with stars, language, topics and a one-line reason it is relevant.
- She is honest when nothing matches: "nobody has built this yet" is a valid and useful answer.
- Acceptance Criteria:
  - [ ] A question returns real, linked public repositories
  - [ ] Each result explains why it is relevant
  - [ ] Private repositories never appear in results
  - [ ] A question with no matches says so instead of returning noise

### 4-Stage Kanban Board

- Main workspace displays a board with 4 columns: `Ready`, `In Progress`, `Blocked`, `Done`.
- Task cards can be moved between stages (drag-and-drop or button actions, TBD during build).
- Each task card shows:
  - Task title
  - Assigned team member
  - Current stage
- Acceptance Criteria:
  - [ ] Tasks are visible in their respective stage columns
  - [ ] Tasks can be moved between stages
  - [ ] The assigned teammate is clearly indicated on task cards

### AI Teammate Task Execution

- When the AI developer teammate is asked to push the work:
  - It creates a dedicated branch in the connected GitHub repo
  - It writes code and raises a pull request
- User can view:
  - Branch name
  - PR link (opens GitHub in new tab)
  - Execution status
- Acceptance Criteria:
  - [ ] The AI-generated branch name is visible
  - [ ] PR link is accessible and opens the actual GitHub PR
  - [ ] Execution status updates as the push progresses

### Reviewer Agent Progression Testing

- When a task reaches a review trigger point (moved to `Done` or explicit review request, TBD during build):
  - Reviewer agent runs automated progression tests (simulating Playwright/Cypress interactions)
  - Reviewer agent generates a structured review report
- Review report includes:
  - Test results (pass/fail per feature or test case)
  - Detailed feedback on what was tested
  - Screenshots or logs (if feasible in PoC scope)
- Project Owner receives the review report in the Review Report View.
- Acceptance Criteria:
  - [ ] Reviewer agent is triggered when appropriate
  - [ ] Review report displays test results clearly
  - [ ] Project Owner can view the report from the workspace

## States and Boundaries

- **First Use (Project Owner)**: After login and role selection, user sees project creation form.
- **First Use (Developer)**: After login and role selection, user sees list of projects they are part of (or empty state with instructions, TBD during build).
- **Empty State (No Tasks)**: Kanban board shows empty columns with affordance to add a task (details TBD during build).
- **Task Stages**: Each task exists in exactly one stage at a time: `Ready`, `In Progress`, `Blocked`, or `Done`.
- **Agent Activity**: AI teammates surface their current activity (idle, working, PR raised, awaiting review).
- **Permissions**: Project Owners can manage projects and teams; Developers can view tasks and work on assigned items. Detailed permission model TBD during build.

## Product Decisions

- **4-stage workflow only**: Keeping stages to `Ready → In Progress → Blocked → Done` keeps the PoC focused and avoids complexity of custom workflows.
- **Fixed cast of AI teammates**: The AI teammates (Michael, Jim, Dwight) are built in rather than picked from a catalogue — fewer setup steps, and each one has a defined job in the loop.
- **GitHub integration deferred to real implementation**: For the PoC, actual GitHub OAuth and live repo connections may be mocked or simplified; live integration is a "Later" item per `scope.md`.
- **Reviewer agent trigger point**: TBD during build—will be determined by what makes the demo flow clearest (automatic on `Done`, or manual trigger).

## What We're Building

- Login screen with email/password authentication
- Role selection: Project Owner or Developer
- Project creation form with repo, timeline, and capacity fields
- Team builder with human teammate role assignment
- 4-stage Kanban board with task cards and drag/move capability
- Task detail or overlay showing AI teammate branch and PR info
- Reviewer agent review report view with test results and feedback
- End-to-end flow demonstrable in a 1-minute video

## Deferred From the POC

- **Live GitHub OAuth & Webhook Integration**: Real-time two-way sync with GitHub is a "Later" feature per `scope.md`. The PoC may use mock data or simplified one-way displays of branch/PR info.
- **Cloud Headless Browser Cluster**: Actually running Playwright in the cloud is deferred. The PoC will simulate or mock reviewer agent test results.
- **Advanced Analytics**: Sprint velocity, burndown charts, and other agile metrics are "Later" per `scope.md`.
- **Multi-user Real-time Collaboration**: While the product envisions teams, the PoC may use a single-user demonstration or simulated team members.
- **User Management & Invitations**: Inviting teammates and managing user accounts in detail is deferred; the PoC may use a simplified roster or preset team list.

## Possible Later Enhancements

- Slack/Jira/Linear integrations for notifications and task sync (cut for PoC per `scope.md`).
- Customizable workflow stages beyond the 4-stage default.
- Detailed agent logs and intermediate work status updates.
- In-app code diff viewer for PR changes.
- Calendar view and timeline Gantt chart for capacity planning.

## Non-Goals

- **Multi-organization enterprise RBAC**: Per `scope.md > Explicitly Cut`, full enterprise access control is out of scope.
- **Third-party integrations** (Jira, Linear, Slack): Cut to protect the 2–4 hour build window.
- **Full authentication system**: Login is a placeholder for the PoC; production-level security, password reset, OAuth providers, etc., are not in scope.
- **Mobile-optimized UI**: The PoC targets desktop/web browser; responsive mobile layout is not a requirement.

## Open Questions

*(To be resolved during build iteration, as stated by the learner)*

- **Task assignment mechanism**: How does a user assign a task to a teammate? Drag-and-drop, dropdown selection, or auto-assignment?
- **Task creation flow**: How are tasks added to the board? Manual entry, import, or predefined for demo purposes?
- **Developer role workflow**: What does a Developer see and do after selecting the Developer role?
- **Review report detail level**: How detailed should the mock progression test feedback be for a compelling demo?
- **Visual design specifics**: Color scheme, typography, component styling—to be determined during build.
- **Data persistence**: Will the PoC use browser localStorage, a mock backend, or no persistence (reset on reload)?
