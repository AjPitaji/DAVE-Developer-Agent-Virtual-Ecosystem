import { getLLMClient, LLM_MODEL } from '@/lib/agents/client';
import type { RepoSnapshot } from '@/lib/github/repo';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface MichaelTeamMember {
  user_id: string;
  name: string;
  /**
   * What this member specializes in — the specialty they declared themselves.
   * Null when they have not set one.
   */
  specialization?: string | null;
}

export interface MichaelContext {
  projectName: string;
  projectDescription: string;
  repoUrl: string | null;
  /**
   * What Michael could read out of the linked GitHub repository. Null when
   * there is no repository (or it could not be read) — the notes on the
   * snapshot explain why in that case.
   */
  repo: RepoSnapshot | null;
  teamMembers: MichaelTeamMember[];
  existingTasks: { title: string; status: string }[];
  /** Project deadline, when one is set. */
  deadline?: string | null;
  /**
   * Extra instructions the team wrote for Michael, verbatim. Michael is told
   * to follow these on top of his normal rules.
   */
  additionalPrompt?: string | null;
}

export interface ProposedTask {
  /** Stable client-side id so we can edit/delete proposals before submit. */
  clientId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** Optional — set to one of teamMembers[*].user_id. May be undefined. */
  suggestedAssigneeId?: string;
  rationale: string;
}

export interface MichaelResponse {
  message: string;
  tasks: ProposedTask[];
}

const SYSTEM_PROMPT = `You are Michael, an AI task-planning agent for the DAVE project management tool.
Your job is to break a project down into concrete, actionable tasks that the team can pick up.

You have the project's title, description, the repository (its file tree and the contents of the most important files), the list of team members (including any specialization they listed), the existing open tasks, and any extra instructions the team wrote for you. Use them all.

${'If the project has a deadline, use it to tailor the task breakdown:'}
${'- Break work into sprints that fit the time left'}
${'- The project description already carries the plan — build on it'}
${'- Prioritize judge-facing deliverables (demo, UI polish, core feature)'}
${'- Include a task for submission/deploy prep if relevant'}

${'When the repository contents are available, ground every task in the real code:'}
${'- Name the actual file paths a task touches, in the task description'}
${'- Reference real components, functions, routes or modules that exist in the files you were shown'}
${'- Match the existing stack, folder layout and naming conventions — do not invent a different architecture'}
${'- Prefer finishing or extending what is already there over greenfield rewrites'}
${'- If the code shows something incomplete, broken or half-built, propose the task that finishes it'}
${'- Never invent file paths, libraries or APIs that are not in the file tree you were given'}

Rules:
- Propose 3 to 8 tasks. Don't spam.
- Tasks must be concrete and shippable in 1–3 days of focused work each.
- Vary priorities appropriately — don't make everything "urgent".
- If you can confidently assign a task to a specific team member based on file ownership or domain, do so; otherwise leave \`suggestedAssigneeId\` out.
- Each team member may carry a \`specialization\` — the specialty they declared themselves. Use it to route work to the person who actually does that kind of work — e.g. send a UI/React task to a "frontend developer", a data-pipeline task to a "data engineer", a design task to a "product designer". A specialization is a stronger signal than the name, so prefer it when the two disagree.
- Avoid duplicating any existing task by title.
- \`rationale\` is a short one-liner explaining *why* this task belongs in the project (shown only in the UI, not the task itself).
- Output valid JSON only, with no commentary.`;

interface RawTask {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  suggestedAssigneeId?: string;
  rationale?: string;
}

const PRIORITY_VALUES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

/**
 * Render the repository snapshot into the prompt.
 *
 * Three parts, in descending usefulness:
 *   1. what the repo is (name, branch, size, stack)
 *   2. the file tree — every path, so Michael can reason about structure
 *   3. the contents of the highest-signal files — so he can name real
 *      components, functions and gaps instead of guessing
 *
 * When nothing could be read, the notes explain why — so Michael degrades
 * honestly rather than inventing a codebase.
 */
function buildRepoSection(repo: RepoSnapshot | null): string {
  if (!repo) {
    return `
Repository:
(no repository information available — base the breakdown on the project description alone)
`;
  }

  const parts: string[] = [];

  const header: string[] = [];
  if (repo.repoFullName) header.push(`Repository: ${repo.repoFullName}`);
  if (repo.defaultBranch) header.push(`Branch: ${repo.defaultBranch}`);
  if (repo.totalFiles > 0) {
    header.push(`Source files found: ${repo.totalFiles}`);
    header.push(`Stack: ${repo.languages}`);
  }
  if (header.length > 0) parts.push(header.join('\n'));

  if (repo.paths.length > 0) {
    const tree = repo.paths.map((p) => `- ${p}`).join('\n');
    const more =
      repo.totalFiles > repo.paths.length
        ? `\n(showing ${repo.paths.length} of ${repo.totalFiles} files)`
        : '';
    parts.push(`File tree:\n${tree}${more}`);
  }

  if (repo.files.length > 0) {
    const blocks = repo.files.map((f) => {
      const cut = f.truncated ? '\n... (file truncated)' : '';
      return `--- ${f.path} ---\n${f.content}${cut}`;
    });
    parts.push(
      `Contents of the key files (${repo.files.length} of ${repo.totalFiles} files):\n${blocks.join('\n')}`
    );
  }

  if (repo.notes.length > 0) {
    parts.push(`Notes about the repository:\n${repo.notes.map((n) => `- ${n}`).join('\n')}`);
  }

  if (parts.length === 0) {
    return `
Repository:
(the repository could not be read — plan from the project description alone)
`;
  }

  return `
Repository:
${parts.join('\n')}
`;
}

function sanitizeTasks(
  raw: unknown,
  memberIds: Set<string>
): ProposedTask[] {
  if (!Array.isArray(raw)) return [];

  const used = new Set<string>();
  const out: ProposedTask[] = [];

  for (const r of raw as RawTask[]) {
    if (!r || typeof r !== 'object') continue;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;

    // De-dupe by lowercased title within this batch
    const key = title.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);

    const description =
      typeof r.description === 'string' ? r.description.trim() : '';

    const priority: TaskPriority = (
      typeof r.priority === 'string' && PRIORITY_VALUES.includes(r.priority as TaskPriority)
        ? (r.priority as TaskPriority)
        : 'medium'
    );

    const suggestedAssigneeId =
      typeof r.suggestedAssigneeId === 'string' &&
      memberIds.has(r.suggestedAssigneeId)
        ? r.suggestedAssigneeId
        : undefined;

    const rationale = typeof r.rationale === 'string' ? r.rationale.trim() : '';

    out.push({
      // clientId is filled by the caller; placeholder here so the type stays
      // uniform. The route will overwrite it before returning to the client.
      clientId: '',
      title,
      description,
      priority,
      suggestedAssigneeId,
      rationale,
    });
  }

  return out;
}

export async function michaelProposeTasks(
  ctx: MichaelContext
): Promise<MichaelResponse> {
  const memberIds = new Set(ctx.teamMembers.map((m) => m.user_id));

  const memberList = (() => {
    const humanLines =
      ctx.teamMembers.length > 0
        ? ctx.teamMembers
            .map((m) => {
              const specialization = m.specialization?.trim();
              return `- user_id: ${m.user_id}  name: ${m.name}${specialization ? `  specialization: ${specialization}` : '  specialization: (not provided)'}`;
            })
            .join('\n')
        : '';
    return humanLines || '(no team members yet — leave suggestedAssigneeId empty)';
  })();

  const repoSection = buildRepoSection(ctx.repo);

  const existingSection =
    ctx.existingTasks.length > 0
      ? ctx.existingTasks
          .map((t) => `- [${t.status}] ${t.title}`)
          .join('\n')
      : '(no existing tasks)';

  const deadlineBlock = (() => {
    if (!ctx.deadline) return '';
    const due = new Date(ctx.deadline);
    if (isNaN(due.getTime())) return '';
    const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return `Deadline: ${due.toUTCString()} (${days} day${days === 1 ? '' : 's'} from now)
`;
  })();

  // The team's own words. Delimited clearly so the model treats it as
  // instructions rather than as more project data.
  const additionalBlock = (() => {
    const extra = ctx.additionalPrompt?.trim();
    if (!extra) return '';
    return `
Additional instructions from the team (these take priority over your defaults — follow them, but never change the output format):
--- BEGIN TEAM INSTRUCTIONS ---
${extra}
--- END TEAM INSTRUCTIONS ---
`;
  })();

  const userPrompt = `Project name: ${ctx.projectName}
Project description: ${ctx.projectDescription}
Repo URL: ${ctx.repoUrl ?? '(not linked)'}
${repoSection}
Team members:
${memberList}

Existing tasks (don't duplicate these):
${existingSection}
${deadlineBlock ? `\n${deadlineBlock}\n` : ''}${additionalBlock}
Propose a focused task list for this project. Return ONLY a JSON object of the form:
{
  "message": "Short summary explaining your plan",
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "priority": "low" | "medium" | "high" | "urgent",
      "suggestedAssigneeId": "<one of the team_members.user_id values, or omit>",
      "rationale": "..."
    }
  ]
}`;

  const completion = await getLLMClient().chat.completions.create({
    // Same model Jim uses — keeps costs and behavior consistent across agents.
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');
  const message =
    typeof raw.message === 'string' && raw.message.trim().length > 0
      ? raw.message.trim()
      : "Here's a task breakdown based on the project context.";
  const tasks = sanitizeTasks(raw.tasks, memberIds);

  return { message, tasks };
}