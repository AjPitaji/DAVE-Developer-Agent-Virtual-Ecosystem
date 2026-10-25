import { getLLMClient, LLM_MODEL } from '@/lib/agents/client';
import { generateProjectKey } from '@/lib/agents/project-key';

export interface JimContext {
  projectId: string;
  projectName: string;
  projectDescription: string;
  teamId: string;
  /** Project deadline, when one is set. */
  deadline?: string | null;
  existingFiles?: string[];
  /**
   * Extra, project-specific instructions the team lead typed into the Jim
   * panel before initializing (e.g. "use TypeScript + Tailwind", "this is a
   * CLI, not a web app"). Appended to Jim's system prompt so it applies to
   * every action — initialize, enhance, chat.
   */
  extraPrompt?: string | null;
}

export interface JimResponse {
  action: 'ask' | 'generate' | 'update';
  message: string;
  files?: { path: string; content: string }[];
  updatedTitle?: string;
  updatedDescription?: string;
  questions?: string[];
  /**
   * Suggested project key (2-4 uppercase chars), e.g. "DV" for DAVE.
   * Returned alongside generated files so the API can persist it to
   * `projects.key` and the UI can let the user override it before push.
   * Optional in the LLM response — if missing, we derive one on the
   * server from the project name.
   */
  suggestedKey?: string;
}

const SYSTEM_PROMPT = `You are Jim, an AI coding agent for the DAVE project management tool.
Your job is to help developers initialize repositories and keep project descriptions up to date.

You have two main capabilities:
1. INITIALIZE REPO: Generate starter files based on the project's tech stack and description
2. EDIT PROJECT DETAILS: Update the project description with more detail based on conversation

${'If the project has a deadline, use it to tailor your suggestions:'}
${'- Keep the scope realistic for the time left (a hackathon build window is usually 24-72 hours)'}
${'- Suggest features that would stand out to judges or reviewers'}

Rules:
- If the project description is placeholder text (e.g., "Add description", "TBD", empty, or generic), ask clarifying questions
- Ask at most 3 focused questions at a time
- When generating files, create realistic starter code for the detected stack
- Supported stacks: Next.js, React, Vue, Python/FastAPI, Node/Express, Go, Rust
- Output files as { path, content } objects
- Keep responses concise and actionable`;

/**
 * Build the final system prompt. Extra, project-specific instructions the
 * team lead typed into the Jim panel are appended as an explicit
 * "additional instructions" section so the model treats them as
 * requirements to follow, not as a description of the project.
 */
function buildSystemPrompt(extraPrompt?: string | null): string {
  const extra = (extraPrompt || '').trim();
  if (!extra) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

Additional instructions from the team (these are requirements — follow them in addition to everything above):
${extra}`;
}

function buildDeadlineBlock(ctx: JimContext): string {
  if (!ctx.deadline) return '';
  const due = new Date(ctx.deadline);
  if (isNaN(due.getTime())) return '';
  const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return `Deadline: ${due.toUTCString()} (${days} day${days === 1 ? '' : 's'} from now)`;
}

/**
 * Restate the team's extra instructions inside the user prompt as well.
 * The system prompt already carries them, but repeating them next to the
 * task keeps them salient when the model is generating files.
 */
function buildExtraPromptBlock(ctx: JimContext): string {
  const extra = (ctx.extraPrompt || '').trim();
  if (!extra) return '';
  return `
Additional instructions from the team (follow these exactly):
${extra}
`;
}

function buildInitializePrompt(ctx: JimContext): string {
  const deadlineBlock = buildDeadlineBlock(ctx);
  return `Project: ${ctx.projectName}
Description: ${ctx.projectDescription}
Team: ${ctx.teamId}
Existing files: ${ctx.existingFiles?.join(', ') || 'None'}
${deadlineBlock ? `\n${deadlineBlock}\n` : ''}
${buildExtraPromptBlock(ctx)}Generate starter files for this repository. Focus on:
- Package/dependency configuration
- Basic project structure
- Entry point
- One example component/route showing the pattern
- README with setup instructions

Return ONLY a JSON object with:
{
  "action": "generate",
  "message": "Brief summary of what was created",
  "files": [{"path": "...", "content": "..."}, ...]
}`;
}

function buildEditDescriptionPrompt(ctx: JimContext, userInput: string): string {
  return `Current description: ${ctx.projectDescription}
User input: ${userInput}
${buildExtraPromptBlock(ctx)}
Update the project description to be more specific and useful for code generation.
Return ONLY a JSON object with:
{
  "action": "update",
  "message": "Description updated",
  "updatedDescription": "The new detailed description"
}`;
}

function buildClarificationPrompt(ctx: JimContext): string {
  return `Project: ${ctx.projectName}
Current description: ${ctx.projectDescription}
${buildExtraPromptBlock(ctx)}
This description is too vague to generate meaningful starter code. Ask 2-3 specific clarifying questions to understand:
- What exactly is being built? (SaaS, dashboard, API, CLI, etc.)
- What is the core domain? (e-commerce, productivity, dev tools, etc.)
- Any specific integrations or requirements?

Return ONLY a JSON object with:
{
  "action": "ask",
  "message": "I need a bit more detail to generate useful starter files.",
  "questions": ["Question 1?", "Question 2?", "Question 3?"]
}`;
}

/**
 * Build the DAVE-specific rule files that get appended to every Jim
 * scaffold. They tell the team (and Dwight) the project's task-id
 * convention so PRs can be linked to issues automatically.
 */
export function buildDaveRuleFiles(
  projectName: string,
  key: string
): { path: string; content: string }[] {
  const safeName = projectName || 'this project';
  return [
    {
      path: '.github/CONTRIBUTING.md',
      content: `# Contributing to ${safeName}

This project is managed in DAVE. Every task has an id like \`${key}-1\`, \`${key}-2\`, …, and Dwight (our AI code reviewer) ties PRs back to those ids.

## Pull requests

- **Reference the task id in the PR title**: \`[${key}-12] Fix nav flicker\`
- **Use the task id in branch names**: \`${key}-12-fix-nav-flicker\`
- **Reference the task id in commit messages**: \`fix(nav): closes ${key}-12\`

Dwight reviews every PR. An \`approved\` verdict closes the task; a \`changes_requested\` verdict sends the task back to in-progress.

## Project key

| Key | ${key} |
| --- | --- |
| Task id pattern | \`${key}-\\d+\` |
| Example | \`${key}-1\` |

See \`.dave/config.json\` for the machine-readable copy.
`,
    },
    {
      path: '.github/PULL_REQUEST_TEMPLATE.md',
      content: `## What does this PR do?

<!-- Replace the placeholder below with the task id, e.g. [${key}-12] -->
Task: [${key}-]

## How was it tested?

-

## Checklist

- [ ] Branch name includes the task id (\`${key}-N-…\`)
- [ ] Commit message references the task id
- [ ] Tested locally
`,
    },
    {
      path: '.dave/config.json',
      content: JSON.stringify(
        {
          key,
          task_id_pattern: `${key}-\\d+`,
          task_id_example: `${key}-1`,
          generated_by: 'jim',
          generated_at: new Date().toISOString(),
        },
        null,
        2
      ) + '\n',
    },
  ];
}

function buildEnhanceAndInitPrompt(
  ctx: JimContext,
  userTitle: string,
  userDescription: string
): string {
  const deadlineBlock = buildDeadlineBlock(ctx);
  return `Project: ${ctx.projectName}
User-provided title: ${userTitle}
User-provided description: ${userDescription}
Existing files: ${ctx.existingFiles?.join(', ') || 'None'}
${deadlineBlock ? `\n${deadlineBlock}\n` : ''}
${buildExtraPromptBlock(ctx)}The user clicked "Initialize Project with Jim". You must do FOUR things in a single response:
1. Polish the project title — keep it short, clear, and professional. Do not invent unrelated features.
2. Enhance the project description with concrete, useful detail (what it does, who it's for, key features, integrations) so a developer could pick it up tomorrow.
3. Suggest a 2-4 char uppercase project KEY derived from the project name (e.g. "DAVE" -> "DV", "My Cool App" -> "MCA"). The key prefixes every task id like "DV-1", "DV-2", and appears in every commit + PR title. Set "suggestedKey" to it.
4. Generate starter files for the repository. Focus on:
   - Package/dependency configuration
   - Basic project structure
   - Entry point
   - One example component/route showing the pattern
   - README with setup instructions
   Supported stacks: Next.js, React, Vue, Python/FastAPI, Node/Express, Go, Rust.
   DO NOT generate .github/CONTRIBUTING.md, .github/PULL_REQUEST_TEMPLATE.md, or .dave/config.json — those are appended automatically by the server using the chosen key.

Return ONLY a JSON object with:
{
  "action": "generate",
  "message": "Short summary of what was enhanced and generated",
  "updatedTitle": "Polished title",
  "updatedDescription": "Enhanced, detailed description",
  "suggestedKey": "DV",
  "files": [{"path": "...", "content": "..."}, ...]
}`;
}

export async function jimInitializeRepo(ctx: JimContext): Promise<JimResponse> {
  const isPlaceholder = !ctx.projectDescription ||
    ctx.projectDescription.trim().length < 20 ||
    /^(add|tbd|todo|placeholder|description|coming soon)/i.test(ctx.projectDescription.trim());

  if (isPlaceholder) {
    const prompt = buildClarificationPrompt(ctx);
const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(ctx.extraPrompt) },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

    return JSON.parse(completion.choices[0].message.content || '{}') as JimResponse;
  }

  const prompt = buildInitializePrompt(ctx);
const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(ctx.extraPrompt) },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(completion.choices[0].message.content || '{}') as JimResponse;
}

export async function jimEnhanceAndInitialize(
  ctx: JimContext,
  userTitle: string,
  userDescription: string
): Promise<JimResponse> {
  const prompt = buildEnhanceAndInitPrompt(ctx, userTitle, userDescription);

  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(ctx.extraPrompt) },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}') as JimResponse;

  // Derive a server-side key if the LLM didn't suggest one. The user's
  // manual override always wins; this is just the deterministic fallback.
  const finalKey =
    (typeof raw.suggestedKey === 'string' && raw.suggestedKey.trim()) ||
    generateProjectKey(raw.updatedTitle || ctx.projectName || userTitle);

  raw.suggestedKey = finalKey;

  // Append the DAVE-specific rule files (CONTRIBUTING guide, PR template,
  // .dave/config.json) so the team has the PR convention visible in every
  // new repo. We add or replace the three paths so a re-run of Jim doesn't
  // end up with stale copies.
  if (Array.isArray(raw.files)) {
    raw.files = raw.files.filter(
      (f) =>
        f?.path !== '.github/CONTRIBUTING.md' &&
        f?.path !== '.github/PULL_REQUEST_TEMPLATE.md' &&
        f?.path !== '.dave/config.json'
    );
    raw.files.push(...buildDaveRuleFiles(ctx.projectName || userTitle, finalKey));
  }

  return raw;
}

export async function jimEditDescription(ctx: JimContext, userInput: string): Promise<JimResponse> {
  const prompt = buildEditDescriptionPrompt(ctx, userInput);
  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(ctx.extraPrompt) },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(completion.choices[0].message.content || '{}') as JimResponse;
}

export async function jimChat(ctx: JimContext, userMessage: string): Promise<JimResponse> {
  const isPlaceholder = !ctx.projectDescription ||
    ctx.projectDescription.trim().length < 20 ||
    /^(add|tbd|todo|placeholder|description|coming soon)/i.test(ctx.projectDescription.trim());

  // If description is placeholder but user gave detailed instruction, update description first
  const userProvidedDetails = userMessage.trim().length > 30 && 
    !/^(help|hi|hello|start|init|generate)/i.test(userMessage.trim());

  if (isPlaceholder && userProvidedDetails) {
    // Update description with user's input, then generate files
    const editResult = await jimEditDescription(ctx, userMessage);
    if (editResult.updatedDescription) {
      // Now generate with updated description
      const updatedCtx = { ...ctx, projectDescription: editResult.updatedDescription };
      const genResult = await jimInitializeRepo(updatedCtx);
      return {
        ...genResult,
        message: `Updated description and ${genResult.message.toLowerCase()}`,
        updatedDescription: editResult.updatedDescription,
      };
    }
    return editResult;
  }

  if (isPlaceholder) {
    return jimInitializeRepo(ctx);
  }

  const prompt = `Project: ${ctx.projectName}
Description: ${ctx.projectDescription}
User: ${userMessage}

Decide: should I generate files, update description, or ask questions?
Return JSON with action: "generate" | "update" | "ask"`;
  
  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(ctx.extraPrompt) },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(completion.choices[0].message.content || '{}') as JimResponse;
}