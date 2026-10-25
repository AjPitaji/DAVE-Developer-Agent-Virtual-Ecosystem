import type { SupabaseClient } from '@supabase/supabase-js';
import { getLLMClient, LLM_MODEL } from '@/lib/agents/client';
import {
  buildAuthorizeUrl,
  GITHUB_REAUTH_REQUIRED,
  isGithubAuthFailure,
} from '@/lib/github/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DwightVerdict = 'approved' | 'changes_requested' | 'comment';

export interface DwightFileFinding {
  /** Path of the file inside the repo, e.g. "app/api/foo/route.ts". */
  path: string;
  /** A 1-2 line headline for this finding. */
  summary: string;
  /** Severity bucket the LLM assigns to this finding. */
  severity: 'info' | 'minor' | 'major' | 'critical';
  /** Optional inline note (no diff context required). */
  note?: string;
}

export interface DwightContext {
  projectId: string;
  projectName: string;
  projectDescription: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string | null;
  repoUrl: string;
  githubToken: string;
}

export interface DwightReview {
  /** Always the project's default branch at review time (e.g. "main"). */
  branch: string;
  /** Commit SHA that was reviewed. */
  commitSha: string;
  /** Short SHA we show in the UI. */
  commitShortSha: string;
  /** Subject line of the reviewed commit. */
  commitMessage: string;
  /** Files we passed to the LLM for review. */
  filesReviewed: string[];
  /**
   * PR context, set when the review was for a linked GitHub PR instead
   * of the latest commit on the default branch. Either both fields are
   * set or both are null.
   */
  prNumber: number | null;
  prUrl: string | null;
  /** Verdict the LLM picked. */
  verdict: DwightVerdict;
  /** 1-3 sentence headline verdict from Dwight. */
  summary: string;
  /** Ordered list of findings, most severe first. */
  findings: DwightFileFinding[];
  /** Markdown body Dwight produced (for the detail view). */
  bodyMarkdown: string;
}

// ---------------------------------------------------------------------------
// GitHub helpers — talk to GitHub's REST API using the user's OAuth token.
// We intentionally avoid @octokit/* to keep the dependency surface small; the
// handful of endpoints we need are easy enough to call with `fetch`.
// ---------------------------------------------------------------------------

interface GithubRepo {
  default_branch: string;
  full_name: string;
}

interface GithubCommitAuthor {
  name?: string;
  email?: string;
  date?: string;
}

interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author?: GithubCommitAuthor;
  };
  files?: GithubCommitFile[];
}

interface GithubCommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  // Accept https://github.com/owner/repo(.git) and git@github.com:owner/repo.git
  const m =
    repoUrl.match(/github\.com[/:]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i) ||
    repoUrl.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Special Error subclass for "GitHub rejected our token". Routes catch this
 * via `instanceof GithubAuthError` and translate it to a
 * `GITHUB_REAUTH_REQUIRED` response so the UI can prompt the user to
 * reconnect. Any other failure keeps the previous behaviour (a plain
 * Error message logged into the review's `error_message`).
 */
export class GithubAuthError extends Error {
  readonly code: string = GITHUB_REAUTH_REQUIRED;
  readonly authorizeUrl: string;
  readonly detail: string;
  constructor(detail: string, returnTo?: string) {
    super(`GitHub auth failed: ${detail}`);
    this.name = 'GithubAuthError';
    this.detail = detail;
    this.authorizeUrl = buildAuthorizeUrl(returnTo);
  }
}

/**
 * Wrap a `fetch(...).then(res => res.json())` flow so that a 401/403
 * with a "bad credentials" body becomes a typed `GithubAuthError` instead
 * of a generic HTTP failure. Used by every GitHub helper in this file so
 * the auth-detection logic lives in exactly one place.
 */
async function ghFetchJson(
  url: string,
  token: string,
  opts: { returnTo?: string; init?: RequestInit } = {}
): Promise<unknown> {
  const res = await fetch(url, {
    ...opts.init,
    headers: { ...ghHeaders(token), ...(opts.init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (res.ok) {
    return res.json();
  }
  // Best-effort body inspection for the auth check. We never throw on
  // parse failure — the status code alone is enough to disambiguate.
  const body = await res.json().catch(() => null);
  if (isGithubAuthFailure(res, body)) {
    const detail =
      (typeof body === 'object' && body && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : null) ?? res.statusText ?? `HTTP ${res.status}`;
    throw new GithubAuthError(detail, opts.returnTo);
  }
  // Non-auth failure: throw a plain error with a useful message so the
  // route's catch block can write it to `error_message`.
  const txt = typeof body === 'string' ? body : '';
  throw new Error(`GitHub request failed (${res.status}): ${(txt || res.statusText || '').slice(0, 200)}`);
}

/**
 * Resolve the repo's default branch ("main" / "master" / whatever the team
 * has set in GitHub settings). We never trust the project's `repo_url` to
 * tell us this, because it varies per repo.
 */
export async function fetchDefaultBranch(
  repoUrl: string,
  token: string,
  opts: { returnTo?: string } = {}
): Promise<{ defaultBranch: string; fullName: string }> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);

  const data = (await ghFetchJson(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    token,
    { returnTo: opts.returnTo }
  )) as GithubRepo;
  return { defaultBranch: data.default_branch, fullName: data.full_name };
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  message: string;
  files: GithubCommitFile[];
}

// ---------------------------------------------------------------------------
// Pull-request types + helpers
//
// When a task has a GitHub PR linked, Dwight reviews the PR's diff instead
// of the latest commit on the default branch. The shape mirrors
// RecentCommit (file list + patches) so the LLM prompt and verdict flow
// are identical — only the source changes.
// ---------------------------------------------------------------------------

export interface PullRequestSummary {
  number: number;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  url: string;
  authorLogin: string;
  merged: boolean;
  draft: boolean;
}

interface GithubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}

interface GithubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

/**
 * Fetch the PR metadata (title, body, base/head branches). 404/401 errors
 * throw so the route handler can return a useful status.
 */
export async function fetchPullRequest(
  repoUrl: string,
  token: string,
  prNumber: number,
  opts: { returnTo?: string } = {}
): Promise<PullRequestSummary> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);

  const pr = (await ghFetchJson(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}`,
    token,
    { returnTo: opts.returnTo }
  )) as GithubPullRequest;
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    url: pr.html_url,
    authorLogin: pr.user?.login ?? 'unknown',
    merged: pr.merged,
    draft: pr.draft,
  };
}

/**
 * Fetch every file in the PR with its patch. Capped at the same 4KB-per-file
 * limit we use for commits, so a monster PR doesn't blow the prompt.
 */
export async function fetchPullRequestFiles(
  repoUrl: string,
  token: string,
  prNumber: number,
  opts: { returnTo?: string } = {}
): Promise<GithubPullRequestFile[]> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);

  // GitHub caps this endpoint at 300 files / 100 per page; we walk pages.
  const all: GithubPullRequestFile[] = [];
  for (let page = 1; page <= 5; page++) {
    const url =
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${prNumber}/files` +
      `?per_page=100&page=${page}`;
    const arr = (await ghFetchJson(url, token, { returnTo: opts.returnTo })) as GithubPullRequestFile[];
    all.push(...arr);
    if (arr.length < 100) break;
  }
  return all;
}

/**
 * Search the repo for a pull request whose title contains the given
 * display_id (e.g. "DG-1"). Used when a task is moved to "done" without
 * a PR explicitly linked on the task row — we look up the PR by title
 * and review its diff instead of falling back to the latest commit on
 * the default branch (which usually doesn't match if the user pushed
 * to a branch and forgot to link it).
 *
 * Returns the most-recently-updated matching PR's number + URL, or
 * `null` when no match is found. We deliberately do not throw on a
 * search miss — the caller falls back to the commit path. Network
 * errors (4xx/5xx) still throw so the route handler can surface them.
 */
export interface PullRequestRef {
  number: number;
  url: string;
}

export async function findPullRequestByDisplayId(
  repoUrl: string,
  token: string,
  displayId: string,
  opts: { returnTo?: string } = {}
): Promise<PullRequestRef | null> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);
  const q = displayId.trim();
  if (!q) return null;

  // GitHub search syntax: type:pr + repo:owner/name + <needle> in:title.
  // We sort by `updated desc` so when multiple titles match (e.g. the
  // user re-opened the same task twice) the most recently touched PR
  // wins. per_page is small — at most a handful of PRs ever share a
  // single display_id, and the search endpoint counts against the
  // search rate limit (30 req/min authenticated).
  const params = new URLSearchParams({
    q: `type:pr repo:${parsed.owner}/${parsed.repo} ${q} in:title`,
    sort: 'updated',
    order: 'desc',
    per_page: '5',
  });
  const data = (await ghFetchJson(
    `https://api.github.com/search/issues?${params.toString()}`,
    token,
    { returnTo: opts.returnTo }
  )) as {
    items?: Array<{
      number?: number;
      html_url?: string;
      title?: string;
      pull_request?: unknown;
    }>;
  };
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    // Defensive: the search can occasionally include issues even with
    // `type:pr` if GitHub's index hasn't fully merged yet, so skip
    // anything that isn't actually a PR.
    if (!item.pull_request) continue;
    if (typeof item.number !== 'number') continue;
    if (typeof item.html_url !== 'string') continue;
    return { number: item.number, url: item.html_url };
  }
  return null;
}

/**
 * Fetch the most recent commit on the default branch, including the file
 * patches so Dwight can review the actual diff. We only pull one commit to
 * keep the review focused on "what changed for this task".
 */
export async function fetchLatestCommit(
  repoUrl: string,
  token: string,
  defaultBranch: string,
  opts: { returnTo?: string } = {}
): Promise<RecentCommit | null> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);

  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${encodeURIComponent(
    defaultBranch
  )}&per_page=1`;
  const arr = (await ghFetchJson(url, token, { returnTo: opts.returnTo })) as GithubCommit[];
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const head = arr[0];
  return {
    sha: head.sha,
    shortSha: head.sha.slice(0, 7),
    message: head.commit.message.split('\n')[0].slice(0, 200),
    files: head.files ?? [],
  };
}

// ---------------------------------------------------------------------------
// Prompt + LLM call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Dwight, a no-nonsense senior code reviewer on the DAVE project management tool.
Your job: when a teammate marks a task done, you check the latest commit on the repo's default branch and tell the team whether the work actually matches the task.

Style:
- Be blunt, specific, and actionable. Cite exact file paths and lines.
- If everything looks good, say so clearly in one sentence. Don't pad.
- If something is wrong, name the file, the problem, and the concrete fix.
- Prefer high-signal findings over long lists. 0-6 findings is normal.
- Never invent files or lines. Only reference what is in the diff.

Output: valid JSON only, no commentary, no markdown fences.`;

interface RawFinding {
  path?: string;
  summary?: string;
  severity?: string;
  note?: string;
}

const SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
type Severity = (typeof SEVERITIES)[number];

function sanitizeFindings(raw: unknown): DwightFileFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: DwightFileFinding[] = [];
  for (const r of raw as RawFinding[]) {
    if (!r || typeof r !== 'object') continue;
    const path = typeof r.path === 'string' ? r.path.trim() : '';
    if (!path) continue;
    const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
    if (!summary) continue;
    const severity: Severity = (
      typeof r.severity === 'string' && (SEVERITIES as readonly string[]).includes(r.severity)
        ? (r.severity as Severity)
        : 'minor'
    );
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
    out.push({ path, summary, severity, note });
  }
  // Stable severity order: critical > major > minor > info
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  return out;
}

function buildPrompt(
  ctx: DwightContext,
  files: { filename: string; status: string; additions: number; deletions: number; patch?: string; previous_filename?: string }[],
  source: { kind: 'commit'; commit: RecentCommit } | { kind: 'pr'; pr: PullRequestSummary }
): string {
  const fileSummary = files
    .map(
      (f) =>
        `- ${f.filename}  (+${f.additions}/-${f.deletions}, status=${f.status}${
          f.previous_filename ? `, renamed from ${f.previous_filename}` : ''
        })`
    )
    .join('\n');

  // Cap each patch to keep tokens bounded. 4KB per file is plenty for a
  // "did this match the task" check.
  const patches = files
    .map((f) => {
      const patch = (f.patch || '').slice(0, 4000);
      return `### ${f.filename}\n\`\`\`diff\n${patch}\n\`\`\``;
    })
    .join('\n\n');

  const sourceHeader =
    source.kind === 'commit'
      ? `Branch reviewed: ${ctx.repoUrl} (default branch)\nCommit: ${source.commit.shortSha} — ${source.commit.message}`
      : `Pull request reviewed: #${source.pr.number} — ${source.pr.title}\n` +
        `Branch: ${source.pr.headRef} → ${source.pr.baseRef}\n` +
        `Author: @${source.pr.authorLogin}${source.pr.draft ? ' (draft)' : ''}${source.pr.merged ? ' (merged)' : ''}\n` +
        `URL: ${source.pr.url}`;

  return `Project: ${ctx.projectName}
Project description: ${ctx.projectDescription || '(none)'}

Task marked done:
- Title: ${ctx.taskTitle}
- Description: ${ctx.taskDescription || '(none)'}

Repo: ${ctx.repoUrl}
${sourceHeader}

${source.kind === 'pr' ? `PR description:\n${source.pr.body || '(empty)'}\n` : ''}Files in this change:
${fileSummary}

Diffs:
${patches || '(no patch content — possibly a merge commit or large binary change)'}

Decide whether this change actually completes the task. Return ONLY a JSON object of the form:
{
  "verdict": "approved" | "changes_requested" | "comment",
  "summary": "One short paragraph — the headline.",
  "findings": [
    { "path": "exact/file/path", "summary": "short headline", "severity": "info|minor|major|critical", "note": "optional detail" }
  ],
  "bodyMarkdown": "Optional longer markdown body with more context. Empty string if you have nothing to add."
}`;
}

const VERDICTS: DwightVerdict[] = ['approved', 'changes_requested', 'comment'];

function parseReview(raw: unknown): Omit<DwightReview, 'branch' | 'commitSha' | 'commitShortSha' | 'commitMessage' | 'filesReviewed'> {
  const obj = (raw ?? {}) as {
    verdict?: string;
    summary?: string;
    findings?: unknown;
    bodyMarkdown?: string;
  };
  const verdict: DwightVerdict = (
    typeof obj.verdict === 'string' && VERDICTS.includes(obj.verdict as DwightVerdict)
      ? (obj.verdict as DwightVerdict)
      : 'comment'
  );
  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim()
      : 'Review complete.';
  const findings = sanitizeFindings(obj.findings);
  const bodyMarkdown =
    typeof obj.bodyMarkdown === 'string' ? obj.bodyMarkdown.trim() : '';
  return { verdict, summary, findings, bodyMarkdown, prNumber: null, prUrl: null };
}

/**
 * Run Dwight against a single commit. Callers are responsible for fetching
 * the default branch + latest commit and passing them in, so this function
 * stays pure and easy to unit-test.
 *
 * If `onStep` is supplied, the LLM call is reported as a step so the
 * caller can stream a "calling LLM…" indicator to the UI.
 *
 * Pass `pr` to review a linked GitHub PR instead of a commit — the LLM
 * prompt adapts to mention the PR title / base-head branches / description.
 */
export async function dwightReview(
  ctx: DwightContext,
  source:
    | { kind: 'commit'; defaultBranch: string; commit: RecentCommit }
    | { kind: 'pr'; pr: PullRequestSummary; files: { filename: string; status: string; additions: number; deletions: number; patch?: string; previous_filename?: string }[]; baseBranch: string },
  onStep?: LogEmitter
): Promise<DwightReview> {
  const files = source.kind === 'commit' ? source.commit.files : source.files;
  const sourceForPrompt =
    source.kind === 'commit'
      ? ({ kind: 'commit', commit: source.commit } as const)
      : ({ kind: 'pr', pr: source.pr } as const);
  const llmStep = 'Calling Dwight LLM';
  onStep?.({
    step: llmStep,
    status: 'started',
    detail: `model=${LLM_MODEL}, files=${files.length}`,
  });
  const llmStart = Date.now();
  let completion;
  try {
    completion = await getLLMClient().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(ctx, files, sourceForPrompt) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
  } catch (err) {
    onStep?.({
      step: llmStep,
      status: 'error',
      detail: err instanceof Error ? err.message : 'LLM call failed',
      duration_ms: Date.now() - llmStart,
    });
    throw err;
  }
  onStep?.({
    step: llmStep,
    status: 'ok',
    detail: `got completion in ${Date.now() - llmStart}ms`,
    duration_ms: Date.now() - llmStart,
  });
  const raw = JSON.parse(completion.choices[0].message.content || '{}');
  const parsed = parseReview(raw);

  // Trivial sanity gate: if the LLM approved but listed major/critical
  // findings, downgrade to changes_requested. We never let "approved" hide
  // real problems.
  const hasMajor = parsed.findings.some(
    (f) => f.severity === 'major' || f.severity === 'critical'
  );
  const verdict: DwightVerdict =
    parsed.verdict === 'approved' && hasMajor ? 'changes_requested' : parsed.verdict;

  if (source.kind === 'commit') {
    return {
      branch: source.defaultBranch,
      commitSha: source.commit.sha,
      commitShortSha: source.commit.shortSha,
      commitMessage: source.commit.message,
      filesReviewed: source.commit.files.map((f) => f.filename),
      prNumber: null,
      prUrl: null,
      verdict,
      summary: parsed.summary,
      findings: parsed.findings,
      bodyMarkdown: parsed.bodyMarkdown,
    };
  }
  return {
    branch: source.baseBranch,
    commitSha: source.pr.headSha,
    commitShortSha: source.pr.headSha.slice(0, 7),
    commitMessage: source.pr.title,
    filesReviewed: source.files.map((f) => f.filename),
    prNumber: source.pr.number,
    prUrl: source.pr.url,
    verdict,
    summary: parsed.summary,
    findings: parsed.findings,
    bodyMarkdown: parsed.bodyMarkdown,
  };
}

// ---------------------------------------------------------------------------
// Verdict application
//
// Dwight's whole point is to act on his review, not just produce one. After
// the review completes we flip the task to its next state:
//   - approved | comment  → "done"   (task is accepted, stays in done col)
//   - changes_requested   → "in_progress" + the in-progress column
// A failed review leaves the task in "under_review" so the user can see
// Dwight is stuck and intervene.
// ---------------------------------------------------------------------------

export interface BoardColumn {
  id: string;
  name: string;
  position: number;
}

export interface VerdictOutcome {
  status: 'done' | 'in_progress';
  // The column the task should sit in. For approved/comment we keep the
  // existing column; for changes_requested we pick the in-progress column.
  columnId: string;
  // Plain-language summary for logs / toast messages.
  message: string;
}

/**
 * Pick the column to push a task into based on Dwight's verdict. Pure
 * function so it's easy to unit-test from the route handler.
 */
export function pickVerdictColumn(
  verdict: DwightVerdict,
  currentColumnId: string,
  columns: BoardColumn[]
): { status: 'done' | 'in_progress'; columnId: string } {
  if (verdict === 'changes_requested') {
    // Prefer a column whose name sounds like "in progress" / "doing" / "review".
    // Fall back to the first non-done column; final fallback: current column.
    const inProgress = columns.find((c) => {
      const k = c.name.toLowerCase();
      return (
        (k.includes('progress') || k.includes('doing') || k.includes('review') || k.includes('testing')) &&
        !k.includes('done') &&
        !k.includes('closed') &&
        !k.includes('complete')
      );
    });
    if (inProgress) return { status: 'in_progress', columnId: inProgress.id };
    const fallback = columns.find((c) => {
      const k = c.name.toLowerCase();
      return !k.includes('done') && !k.includes('closed') && !k.includes('complete');
    });
    return { status: 'in_progress', columnId: fallback?.id ?? currentColumnId };
  }
  // approved or comment: task is done, keep the column the user dropped it in.
  return { status: 'done', columnId: currentColumnId };
}

export function buildVerdictMessage(
  verdict: DwightVerdict,
  reviewSummary: string
): string {
  if (verdict === 'approved') return `Approved — task accepted. ${reviewSummary}`;
  if (verdict === 'changes_requested')
    return `Changes requested — task bounced back to in progress. ${reviewSummary}`;
  return `Dwight left a comment. ${reviewSummary}`;
}

// ---------------------------------------------------------------------------
// "PR not found" bounce-back
//
// When a task has a `display_id` (e.g. "DV-12") but no matching GitHub PR
// exists, reviewing the default-branch HEAD is worse than useless: it
// grades whatever the last person pushed to `main`, which is almost never
// this task's work. So instead of silently reviewing the wrong thing we
// refuse to review, bounce the task back to In Progress, and leave a
// failed review row behind so the Dwight panel explains exactly what
// happened.
//
// This is the same shape as a `changes_requested` verdict (status =
// in_progress + the in-progress column), so the board renders it
// identically to a real rejection.
// ---------------------------------------------------------------------------

export const PR_NOT_FOUND = 'PR_NOT_FOUND';

export interface PrNotFoundOutcome {
  /** HTTP status for the route response. 400 = the request was fine, the
   *  precondition (a matching PR) was not. */
  status: number;
  /** User-facing one-liner. */
  error: string;
  /** Longer explanation shown in the Dwight review detail. */
  summary: string;
  /** Task row after the bounce-back, so the board can update optimistically. */
  updatedTask?: Record<string, unknown>;
}

/**
 * Bounce a task back to In Progress because we couldn't find its PR, and
 * record a `failed` review row explaining why. Safe to call more than
 * once for the same task — each call writes its own review row, matching
 * how Dwight records every other outcome.
 */
export async function bounceBackPrNotFound(input: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  task: DwightPrPipelineTask & { display_id?: string | null };
  projectColumns: BoardColumn[];
  /** The task's current column, used if no in-progress column exists. */
  currentColumnId: string;
  /** True when the task has no `display_id` at all (nothing to search for). */
  hasDisplayId: boolean;
}): Promise<PrNotFoundOutcome> {
  const {
    supabase,
    userId,
    projectId,
    task,
    projectColumns,
    currentColumnId,
    hasDisplayId,
  } = input;

  const displayId = task.display_id ?? null;
  const searchHint = hasDisplayId
    ? `No GitHub pull request mentions ${displayId} in its title.`
    : 'This task has no display id, so there is nothing to match a pull request against.';

  const summary = `PR not found — ${searchHint} Link the PR to this task, then mark it done again.`;
  const error = `PR not found${hasDisplayId ? ` for ${displayId}` : ''}. Dwight did not run.`;

  // Move the task back to the in-progress column using the exact same
  // column-picking logic as a `changes_requested` verdict, so the board
  // renders this identically to a real rejection.
  const outcome = pickVerdictColumn('changes_requested', currentColumnId, projectColumns);

  const { data: updatedTask, error: updateError } = await supabase
    .from('tasks')
    .update({ status: outcome.status, column_id: outcome.columnId })
    .eq('id', task.id)
    .select('id, status, column_id, last_review_id, last_review_verdict')
    .single();

  if (updateError) {
    console.error('Dwight: failed to bounce task back to in progress:', updateError);
  }

  // Record a failed review so the Dwight panel can explain the bounce
  // instead of showing a stale "reviewing…" spinner.
  const failedRow = {
    project_id: projectId,
    task_id: task.id,
    verdict: 'comment' as const,
    summary,
    findings: [],
    body_markdown: '',
    branch: '',
    commit_sha: '',
    commit_short_sha: '',
    commit_message: '',
    files_reviewed: [],
    pr_number: null,
    pr_url: task.pr_url ?? null,
    status: 'failed',
    error_message: error,
    triggered_by: userId,
  };

  // The `log` column was added in a follow-up migration. Try with it, and
  // retry without it if it's missing on this project — the bounce-back has
  // already happened by this point, so a failed review row is cosmetic.
  const withLog = await supabase
    .from('task_reviews')
    .insert({ ...failedRow, log: [] })
    .select('id')
    .single();

  if (withLog.error) {
    const msg = withLog.error.message ?? '';
    if (/column .*log .*does not exist/i.test(msg) || /log.*column/i.test(msg)) {
      const withoutLog = await supabase
        .from('task_reviews')
        .insert(failedRow)
        .select('id')
        .single();
      if (withoutLog.error) {
        console.error('Dwight: could not record PR-not-found review row:', withoutLog.error.message);
      }
    } else {
      console.error('Dwight: could not record PR-not-found review row:', msg);
    }
  }

  return {
    status: 400,
    error,
    summary,
    updatedTask: (updatedTask as Record<string, unknown> | null) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Live activity log
//
// Every step the Dwight pipeline runs (GitHub lookup, commit fetch, LLM
// call, verdict application) writes a log entry so the UI can show a real-
// time terminal. Each step has a `started` entry that gets mutated to `ok`
// or `error` when the step finishes, with a duration_ms so the user can
// see which step is slow.
// ---------------------------------------------------------------------------

export type LogStatus = 'started' | 'ok' | 'error' | 'info';

export interface LogEntry {
  ts: string;
  step: string;
  status: LogStatus;
  detail?: string;
  duration_ms?: number;
}

/**
 * Callback signature for streaming log events out of dwightReview. The API
 * route wires this to a ReviewLogger that flushes to the DB so the UI can
 * subscribe to live progress.
 */
export type LogEmitter = (event: {
  step: string;
  status: 'started' | 'ok' | 'error' | 'info';
  detail?: string;
  duration_ms?: number;
}) => void;

/**
 * Pure-ish helper that records a log entry into a logger + writes the full
 * entry array out via the supplied flush function. Writes are chained so
 * they don't race when several steps complete in quick succession.
 */
export class ReviewLogger {
  private entries: LogEntry[] = [];
  private startTimes = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly flush: (entries: LogEntry[]) => Promise<unknown>) {}

  start(step: string, detail?: string): void {
    const now = Date.now();
    this.startTimes.set(step, now);
    this.entries.push({
      ts: new Date(now).toISOString(),
      step,
      status: 'started',
      detail,
    });
    this.scheduleFlush();
  }

  finish(step: string, status: 'ok' | 'error', detail?: string, durationMs?: number): void {
    const now = Date.now();
    const startTime = this.startTimes.get(step);
    // If the caller didn't pass a duration, derive it from the recorded
    // start time. Callers that already measure with Date.now() can pass
    // their own number to avoid a clock-skew mismatch.
    const duration =
      typeof durationMs === 'number'
        ? durationMs
        : startTime
        ? now - startTime
        : undefined;
    // Mutate the latest 'started' entry for this step rather than appending,
    // so the UI sees a single row that flips from "in progress" to "ok".
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].step === step && this.entries[i].status === 'started') {
        this.entries[i] = {
          ...this.entries[i],
          status,
          detail: detail ?? this.entries[i].detail,
          duration_ms: duration,
        };
        break;
      }
    }
    this.scheduleFlush();
  }

  info(step: string, detail?: string): void {
    this.entries.push({
      ts: new Date().toISOString(),
      step,
      status: 'info',
      detail,
    });
    this.scheduleFlush();
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /** Block until any pending write has been attempted. Used at the end of
   *  the review so the final state is guaranteed to be persisted. */
  async finalFlush(): Promise<void> {
    await this.chain.catch(() => undefined);
    await this.flush([...this.entries]);
  }

  private scheduleFlush(): void {
    const snapshot = [...this.entries];
    this.chain = this.chain
      .then(() => this.flush(snapshot))
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Shared PR-review pipeline
//
// Both the explicit PR-review route (`/review-pr`) and the default-branch
// review route (`/review`) end up running the same Dwight pipeline once a
// PR has been resolved. This helper runs the pipeline end-to-end:
//
//   1. Create a pending `task_reviews` row (with the same `log` column
//      fallback the original route had).
//   2. Build a `ReviewLogger` that streams every step into `task_reviews.log`.
//   3. Flip the task to `under_review`.
//   4. Fetch the PR metadata + files via GitHub. Network errors are
//      turned into a `failed` review row + a structured 502 result so
//      the route handler can surface them.
//   5. Run Dwight against the PR diff.
//   6. Persist the verdict + diff summary on the review row.
//   7. Apply the verdict to the task (done vs in_progress).
//
// Every failure path marks the review `status = 'failed'` and returns a
// structured `DwightPrReviewFailure` so the route handler can mirror the
// original error semantics (status code + optional reviewId).
// ---------------------------------------------------------------------------

export interface DwightPrPipelineTask {
  id: string;
  title: string;
  description: string | null;
  column_id: string;
  pr_url?: string | null;
  pr_branch?: string | null;
}

export interface DwightPrPipelineProject {
  id: string;
  name: string;
  description: string | null;
  repo_url: string;
}

export interface DwightPrReviewInput {
  readonly supabase: SupabaseClient;
  readonly userId: string;
  readonly project: DwightPrPipelineProject;
  readonly task: DwightPrPipelineTask;
  readonly projectColumns: BoardColumn[];
  readonly prNumber: number;
  readonly githubToken: string;
  /**
   * Where the user should land after a successful re-authentication.
   * Forwarded into `GithubAuthError.authorizeUrl` so the OAuth callback
   * drops them back on the same project page. Optional — the callback
   * defaults to `/settings` when not provided.
   */
  readonly returnTo?: string;
  /**
   * When the caller has already opened a review row (e.g. to log the
   * "Searching for pull request" step), it threads that handle through
   * here so the PR pipeline keeps appending to the same log instead of
   * starting a second review row.
   */
  readonly existingRun?: ReviewRunHandle;
}

export interface DwightPrReviewSuccess {
  readonly ok: true;
  readonly reviewId: string;
  readonly review: Record<string, unknown>;
  readonly verdictApplied: boolean;
  readonly updatedTask?: Record<string, unknown>;
  readonly message: string;
}

export interface DwightPrReviewFailure {
  readonly ok: false;
  readonly reviewId?: string;
  readonly status: number;
  readonly error: string;
  /** Present when the failure was a token-invalidation — see lib/github/server.ts. */
  readonly code?: typeof GITHUB_REAUTH_REQUIRED;
  /** OAuth authorize URL the UI should send the user to. */
  readonly authorizeUrl?: string;
}

export type DwightPrReviewResult = DwightPrReviewSuccess | DwightPrReviewFailure;

interface PendingBaseRow {
  project_id: string;
  task_id: string;
  verdict: 'comment';
  summary: string;
  findings: unknown[];
  body_markdown: string;
  branch: string;
  commit_sha: string;
  commit_short_sha: string;
  commit_message: string;
  files_reviewed: string[];
  pr_number: number;
  pr_url: string | null;
  log: unknown[];
  status: 'pending';
  triggered_by: string;
}

const SELECT_REVIEW_COLUMNS =
  'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, pr_number, pr_url, log, status, error_message, triggered_by, created_at, updated_at';

export interface ReviewRunHandle {
  /** The `task_reviews` row this run streams into. */
  readonly reviewId: string;
  /** Streams every step into that row's `log` jsonb column. */
  readonly logger: ReviewLogger;
  /**
   * False when the `log` column doesn't exist on this project (older
   * schema). Callers keep running; the terminal is just empty.
   */
  readonly logColumnAvailable: boolean;
}

/**
 * Create a pending `task_reviews` row plus the `ReviewLogger` that streams
 * into it. Both Dwight pipelines (default-branch and PR) start with this so
 * the activity terminal is live from the very first step — including the
 * "Searching for pull request" step, which used to run before any row
 * existed and was therefore invisible to the user.
 *
 * The `log` column was added in a follow-up migration, so an insert that
 * includes it can fail on projects created before that migration. We detect
 * that specific failure and retry without the column; any other insert
 * error is real and is surfaced to the caller.
 */
export async function beginReviewRun(input: {
  supabase: SupabaseClient;
  projectId: string;
  taskId: string;
  triggeredBy: string;
  /** Shown in the review list while the run is in flight. */
  summary: string;
  prNumber?: number | null;
  prUrl?: string | null;
}): Promise<
  | { ok: true; handle: ReviewRunHandle }
  | { ok: false; error: string }
> {
  const { supabase, projectId, taskId, triggeredBy, summary, prNumber, prUrl } = input;

  const baseRow = {
    project_id: projectId,
    task_id: taskId,
    verdict: 'comment' as const,
    summary,
    findings: [],
    body_markdown: '',
    branch: '',
    commit_sha: '',
    commit_short_sha: '',
    commit_message: '',
    files_reviewed: [] as string[],
    pr_number: prNumber ?? null,
    pr_url: prUrl ?? null,
    status: 'pending' as const,
    triggered_by: triggeredBy,
  };

  let row: { id: string } | null = null;
  let logColumnAvailable = true;

  const first = await supabase
    .from('task_reviews')
    .insert({ ...baseRow, log: [] })
    .select('id')
    .single();

  if (first.error || !first.data) {
    const msg = first.error?.message ?? '';
    if (/column .*log .*does not exist/i.test(msg) || /log.*column/i.test(msg)) {
      logColumnAvailable = false;
      const fallback = await supabase
        .from('task_reviews')
        .insert(baseRow)
        .select('id')
        .single();
      if (fallback.error || !fallback.data) {
        return {
          ok: false,
          error: fallback.error?.message || 'Failed to create review record',
        };
      }
      row = fallback.data;
    } else {
      return { ok: false, error: first.error?.message || 'Failed to create review record' };
    }
  } else {
    row = first.data;
  }

  const reviewId = row.id as string;
  const logger = new ReviewLogger(async (entries: LogEntry[]) => {
    if (!logColumnAvailable) return;
    const { error } = await supabase
      .from('task_reviews')
      .update({ log: entries })
      .eq('id', reviewId);
    if (error) {
      // Don't throw — losing one log write shouldn't abort the review.
      console.warn('Dwight: log flush failed:', error.message);
    }
  });

  return { ok: true, handle: { reviewId, logger, logColumnAvailable } };
}

/**
 * Run the full Dwight PR-review pipeline. Returns a structured result the
 * caller can serialise to JSON — failures carry an HTTP status so the
 * route handler can mirror the original error semantics.
 *
 * Pass `existingRun` when the caller already opened a review row (e.g. to
 * log the PR search). The pipeline then adopts that row instead of
 * creating a second one, so the whole attempt — search, fetch, review,
 * verdict — reads as a single continuous activity log.
 */
export async function runDwightPrReview(
  input: DwightPrReviewInput
): Promise<DwightPrReviewResult> {
  const { supabase, userId, project, task, projectColumns, prNumber, githubToken, returnTo } =
    input;
  const existingRun = input.existingRun;

  // ---- 1. Create (or adopt) a pending review row -------------------------
  let reviewId: string;
  let logger: ReviewLogger;
  let logColumnAvailable: boolean;

  if (existingRun) {
    reviewId = existingRun.reviewId;
    logger = existingRun.logger;
    logColumnAvailable = existingRun.logColumnAvailable;
    // Refresh the in-flight summary + PR link now that we know the number,
    // so the review list shows "reviewing PR #N" rather than the generic
    // "looking for your pull request" text the search step wrote.
    const { error: patchError } = await supabase
      .from('task_reviews')
      .update({ summary: `Dwight is reviewing PR #${prNumber}…`, pr_number: prNumber })
      .eq('id', reviewId);
    if (patchError) {
      console.warn('Dwight: could not update review summary:', patchError.message);
    }
  } else {
    const started = await beginReviewRun({
      supabase,
      projectId: project.id,
      taskId: task.id,
      triggeredBy: userId,
      summary: `Dwight is reviewing PR #${prNumber}…`,
      prNumber,
      prUrl: task.pr_url ?? null,
    });
    if (!started.ok) {
      return { ok: false, status: 500, error: started.error };
    }
    reviewId = started.handle.reviewId;
    logger = started.handle.logger;
    logColumnAvailable = started.handle.logColumnAvailable;
  }

  // ---- 2. Logger bootstrap ----------------------------------------------
  logger.info('Queued', `task=${task.title}, pr=#${prNumber}`);

  // ---- 3. Mark task under_review ----------------------------------------
  logger.start('Mark task under review');
  const { data: freshTask } = await supabase
    .from('tasks')
    .select('status')
    .eq('id', task.id)
    .maybeSingle();
  const currentStatus = (freshTask as { status: string } | null)?.status;
  if (currentStatus && currentStatus !== 'under_review') {
    const { error: markError } = await supabase
      .from('tasks')
      .update({ status: 'under_review' })
      .eq('id', task.id);
    if (markError) {
      logger.finish('Mark task under review', 'error', markError.message);
      console.warn('Dwight: could not mark task under_review:', markError.message);
    } else {
      logger.finish('Mark task under review', 'ok', `task was ${currentStatus}`);
    }
  } else {
    logger.finish('Mark task under review', 'ok', 'already under_review');
  }

  // ---- 4. Fetch PR metadata + files -------------------------------------
  let prSummary;
  const prStart = Date.now();
  logger.start('Fetching pull request', `GET /repos/.../pulls/${prNumber}`);
  try {
    prSummary = await fetchPullRequest(project.repo_url, githubToken, prNumber, { returnTo });
  } catch (err) {
    if (err instanceof GithubAuthError) {
      logger.finish('Fetching pull request', 'error', err.detail, Date.now() - prStart);
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: err.detail,
          pr_number: prNumber,
          summary: 'GitHub connection expired. Reconnect to continue.',
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return {
        ok: false,
        reviewId,
        status: 401,
        error: 'GitHub connection expired. Reconnect to continue.',
        code: GITHUB_REAUTH_REQUIRED,
        authorizeUrl: err.authorizeUrl,
      };
    }
    const message = err instanceof Error ? err.message : 'GitHub PR fetch failed';
    logger.finish('Fetching pull request', 'error', message, Date.now() - prStart);
    await supabase
      .from('task_reviews')
      .update({
        status: 'failed',
        error_message: message,
        pr_number: prNumber,
        summary: `Couldn't fetch PR #${prNumber}: ${message}`,
      })
      .eq('id', reviewId);
    await logger.finalFlush();
    return { ok: false, reviewId, status: 502, error: message };
  }
  logger.finish(
    'Fetching pull request',
    'ok',
    `#${prSummary.number} — ${prSummary.title} (${prSummary.headRef} → ${prSummary.baseRef})`,
    Date.now() - prStart
  );

  const filesStart = Date.now();
  logger.start('Fetching PR files', `GET /repos/.../pulls/${prNumber}/files (paged)`);
  let prFiles;
  try {
    prFiles = await fetchPullRequestFiles(project.repo_url, githubToken, prNumber, { returnTo });
  } catch (err) {
    if (err instanceof GithubAuthError) {
      logger.finish('Fetching PR files', 'error', err.detail, Date.now() - filesStart);
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: err.detail,
          pr_number: prNumber,
          pr_url: prSummary.url,
          summary: 'GitHub connection expired. Reconnect to continue.',
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return {
        ok: false,
        reviewId,
        status: 401,
        error: 'GitHub connection expired. Reconnect to continue.',
        code: GITHUB_REAUTH_REQUIRED,
        authorizeUrl: err.authorizeUrl,
      };
    }
    const message = err instanceof Error ? err.message : 'GitHub PR files fetch failed';
    logger.finish('Fetching PR files', 'error', message, Date.now() - filesStart);
    await supabase
      .from('task_reviews')
      .update({
        status: 'failed',
        error_message: message,
        pr_number: prNumber,
        pr_url: prSummary.url,
        summary: `Couldn't fetch PR files: ${message}`,
      })
      .eq('id', reviewId);
    await logger.finalFlush();
    return { ok: false, reviewId, status: 502, error: message };
  }
  logger.finish(
    'Fetching PR files',
    'ok',
    `${prFiles.length} file${prFiles.length === 1 ? '' : 's'} (${prSummary.headSha.slice(0, 7)})`,
    Date.now() - filesStart
  );

  // ---- 5. Run Dwight ----------------------------------------------------
  const ctx: DwightContext = {
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description ?? '',
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    repoUrl: project.repo_url,
    githubToken,
  };

  let review;
  try {
    review = await dwightReview(
      ctx,
      {
        kind: 'pr',
        pr: prSummary,
        files: prFiles,
        baseBranch: prSummary.baseRef,
      },
      (event) => {
        if (event.status === 'started') {
          logger.start(event.step, event.detail);
        } else if (event.status === 'ok' || event.status === 'error') {
          logger.finish(event.step, event.status, event.detail, event.duration_ms);
        } else {
          logger.info(event.step, event.detail);
        }
      }
    );
    logger.info(
      `Dwight returned ${review.verdict}`,
      `${review.findings.length} finding${review.findings.length === 1 ? '' : 's'}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dwight failed';
    logger.info('Dwight crashed', message);
    await supabase
      .from('task_reviews')
      .update({
        status: 'failed',
        error_message: message,
        pr_number: prNumber,
        pr_url: prSummary.url,
        files_reviewed: prFiles.map((f) => f.filename),
        summary: `Dwight crashed: ${message}`,
      })
      .eq('id', reviewId);
    await logger.finalFlush();
    return { ok: false, reviewId, status: 500, error: message };
  }

  // ---- 6. Persist final review ------------------------------------------
  logger.start('Persisting review');
  const persistStart = Date.now();
  const { data: finalRow, error: finalError } = await supabase
    .from('task_reviews')
    .update({
      status: 'completed',
      verdict: review.verdict,
      summary: review.summary,
      findings: review.findings,
      body_markdown: review.bodyMarkdown,
      branch: review.branch,
      commit_sha: review.commitSha,
      commit_short_sha: review.commitShortSha,
      commit_message: review.commitMessage,
      files_reviewed: review.filesReviewed,
      pr_number: review.prNumber,
      pr_url: review.prUrl,
    })
    .eq('id', reviewId)
    .select(SELECT_REVIEW_COLUMNS)
    .single();
  if (finalError || !finalRow) {
    logger.finish('Persisting review', 'error', finalError?.message, Date.now() - persistStart);
    await logger.finalFlush();
    return {
      ok: false,
      reviewId,
      status: 500,
      error: finalError?.message || 'Failed to persist review',
    };
  }
  logger.finish('Persisting review', 'ok', `row ${reviewId}`, Date.now() - persistStart);

  // ---- 7. Apply verdict to the task -------------------------------------
  const outcome = pickVerdictColumn(review.verdict, task.column_id, projectColumns);
  const verdictMessage = buildVerdictMessage(review.verdict, review.summary);
  const targetColumnName =
    projectColumns.find((c) => c.id === outcome.columnId)?.name ?? '?';

  logger.start(
    'Applying verdict to task',
    `${review.verdict} → status=${outcome.status}, column=${targetColumnName}`
  );
  const applyStart = Date.now();
  const { data: updatedTask, error: applyError } = await supabase
    .from('tasks')
    .update({
      status: outcome.status,
      column_id: outcome.columnId,
      last_review_id: reviewId,
      last_review_verdict: review.verdict,
    })
    .eq('id', task.id)
    .select('id, status, column_id, last_review_id, last_review_verdict')
    .single();
  if (applyError || !updatedTask) {
    logger.finish(
      'Applying verdict to task',
      'error',
      applyError?.message ?? 'task update returned no row',
      Date.now() - applyStart
    );
    await logger.finalFlush();
    return {
      ok: true,
      reviewId,
      review: finalRow as Record<string, unknown>,
      verdictApplied: false,
      message: verdictMessage,
    };
  }
  logger.finish(
    'Applying verdict to task',
    'ok',
    `task is now ${updatedTask.status} in column ${targetColumnName}`,
    Date.now() - applyStart
  );
  logger.info('Review complete', verdictMessage);
  await logger.finalFlush();

  return {
    ok: true,
    reviewId,
    review: finalRow as Record<string, unknown>,
    verdictApplied: true,
    updatedTask: updatedTask as Record<string, unknown>,
    message: verdictMessage,
  };
}