---
doc: scope
status: approved
---

# DAVE (Developer & Agent Virtual Ecosystem)

An agile workflow platform for small teams that pairs human teammates with three built-in AI teammates — an AI project manager, an AI developer, and an AI reviewer — to automate task breakdown, branch/PR creation, and automated progression test reviews.

## The Unique Kernel
Built-in AI teammates work the board alongside humans: Michael breaks a project into shippable tasks and routes them to the right teammate, Jim pushes the code on a dedicated branch and raises the PR, Dwight runs progression testing on the live feature and delivers a structured review report straight to the project owner, and Pam answers the question every team asks before building something — has anyone done this before? — by searching public GitHub for projects that already do it.

## Who It's For
Small development teams and project owners who lack a dedicated agile lead or QA coordinator. Today, they lose time manually managing boards, writing boilerplate branches/PRs, and manually validating deployed features.

## The Core Loop
1. Project owner sets up a project with timeline/capacity estimates and GitHub repo details.
2. Owner invites human teammates; the three AI teammates join the project workspace from the start.
3. Tasks move through 4 progress stages: `Ready` → `In Progress` → `Blocked` → `Done`.
4. AI teammates execute tasks in dedicated branches and raise PRs.
5. The Reviewer agent inspects feature progression (Playwright/Cypress style) and provides structured review feedback to the project owner to verify completion.

## Inspiration & Identity
Fast, developer-centric agile workspace with clear stage visibility, live agent activity, and structured test/review reports.

## Why This Matters to the Learner
To build a working proof-of-concept demonstrating an end-to-end autonomous agile assistance workflow for small development teams.

## What "Working" Looks Like
A 1-minute demo walking through the complete project lifecycle:
1. Creating a new project with repo and timeline details.
2. Assembling a team of human teammates, with the AI teammates already in the workspace.
3. Assigning a task across the 4-stage board (`Ready`, `In Progress`, `Blocked`, `Done`).
4. Viewing the AI teammate's branch and PR output.
5. Triggering the Reviewer agent to run a progression test check and view the resulting review report.

## The POC Boundary
- Project creation interface with repo configuration and capacity intake.
- Team builder for human teammates.
- AI task planner that reads the linked repository — file tree and the contents of the key files — and grounds every proposed task in real file paths.
- Prior-art search: ask any technical question and get back the closest matching public GitHub repositories, each with a one-line reason it is relevant.
- Interactive 4-stage Kanban task board (`Ready`, `In Progress`, `Blocked`, `Done`).
- Agent task execution view showing branch & PR artifacts.
- Reviewer agent feature check flow producing detailed progression feedback.

## Later
- Live two-way GitHub Webhooks & OAuth sync.
- Cloud headless browser infrastructure running live Playwright sessions.
- Advanced agile analytics (velocity tracking, burndown charts).

## Explicitly Cut
- Multi-organization enterprise role-based access control (RBAC).
- Third-party integrations (Jira, Linear, Slack sync) to protect the 2–4 hour hackathon build window.
