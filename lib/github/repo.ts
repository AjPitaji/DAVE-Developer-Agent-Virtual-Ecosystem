/**
 * Reading a GitHub repository into a prompt-friendly snapshot.
 *
 * Why this module exists
 * ----------------------
 * Michael (the AI task planner) used to look up file paths in a `github_files`
 * table. That table was never created by any migration and nothing ever wrote
 * to it, so the lookup silently returned nothing and Michael's prompt always
 * said "(no repo files tracked yet)". He was working blind — he could not see
 * the stack, the structure, or a single line of the code he was planning
 * tasks for.
 *
 * This module replaces that phantom lookup with the real thing: the GitHub
 * REST API, using the same OAuth token Dwight and Jim already use.
 *
 * What it produces
 * ----------------
 * A `RepoSnapshot` is deliberately bounded. An LLM prompt is a fixed budget,
 * and a real repository is not:
 *
 *   - the full file tree is capped (paths only — cheap, and it tells Michael
 *     the shape of the project)
 *   - file *contents* are capped to a small set of the most important files,
 *     each truncated, with a global character budget
 *   - everything is best-effort: a missing token, a private repo, or a
 *     network hiccup degrades to "I couldn't read the repo" rather than
 *     throwing and killing the whole request
 *
 * Nothing here mutates anything on GitHub — it is read-only.
 */

import { githubAuthHeaders } from '@/lib/github/server';

/** A file we read the contents of. */
export interface RepoFileContent {
  path: string;
  /** File text, truncated to the per-file budget. */
  content: string;
  /** True when the file was longer than the per-file budget. */
  truncated: boolean;
}

/**
 * A bounded, prompt-ready view of a repository.
 *
 * `notes` carries human-readable explanations for anything we could not do
 * (no token, private repo, network failure). Michael is told about these so
 * he does not invent file details he never saw.
 */
export interface RepoSnapshot {
  /** "owner/repo" when we could resolve the repo, else null. */
  repoFullName: string | null;
  /** The repo's default branch when known, else null. */
  defaultBranch: string | null;
  /** Up to `MAX_TREE_PATHS` interesting file paths. */
  paths: string[];
  /** How many interesting files the repo actually has. */
  totalFiles: number;
  /** GitHub truncated its own tree response (very large repos). */
  treeTruncated: boolean;
  /** Contents of the highest-signal files. */
  files: RepoFileContent[];
  /** "TypeScript (120), CSS (12)" — a quick read on the stack. */
  languages: string;
  /** Anything that went wrong, in plain language. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** How many file paths to include in the prompt. */
const MAX_TREE_PATHS = 220;
/** How many files to actually read the contents of. */
const MAX_CONTENT_FILES = 12;
/** Per-file character budget. */
const MAX_CHARS_PER_FILE = 2400;
/** Total character budget across all file contents. */
const MAX_TOTAL_CONTENT_CHARS = 18000;
/** Files larger than this are skipped (their contents are not worth the budget). */
const MAX_FILE_BYTES = 24000;

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Directories that never contain useful source. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.turbo', '.cache',
  'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  'target', '.gradle', '.idea', '.vscode', '.terraform',
  'bin', 'obj', 'Pods', 'DerivedData',
]);

/** Lock files — huge, and tell Michael nothing about the code. */
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'poetry.lock', 'cargo.lock', 'go.sum', 'composer.lock', 'gemfile.lock',
  'packages.lock.json',
]);

/** Binary / asset extensions — excluded from both the tree and the contents. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'pdf',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'avi', 'mov', 'm4a',
  'wasm', 'so', 'dll', 'dylib', 'exe', 'bin', 'class', 'pyc',
  'sqlite', 'db', 'lock',
]);

/** Extensions worth reading the contents of. */
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java',
  'kt', 'kts', 'rb', 'php', 'cs', 'swift', 'scala', 'dart', 'lua',
  'sql', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'ps1',
  'html', 'css', 'scss', 'sass', 'less', 'json', 'jsonc',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'md', 'mdx', 'txt',
  'graphql', 'gql', 'proto', 'tf', 'dockerfile', 'makefile', 'gradle',
]);

/**
 * Files that explain the project best. Listed in priority order — the first
 * matches win, so README beats an arbitrary source file.
 */
const PRIORITY_FILES = [
  'readme.md', 'readme', 'package.json', 'pyproject.toml',
  'requirements.txt', 'cargo.toml', 'go.mod', 'pom.xml',
  'build.gradle', 'gemfile', 'composer.json', 'deno.json',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'tsconfig.json', 'next.config.js', 'next.config.ts', 'next.config.mjs',
  'vite.config.ts', 'vite.config.js', 'makefile', 'justfile',
  '.env.example', '.env.sample',
];

/** Path fragments that usually mark an entry point. */
const ENTRY_HINTS = [
  'src/index', 'src/main', 'src/app', 'app/main', 'app/index',
  'app/page', 'app/route', 'server', 'cli', 'index.', 'main.',
];

/** Split a path into its lowercase segments. */
function segments(path: string): string[] {
  return path.toLowerCase().split('/');
}

/** The file extension without the dot, lowercased ('' when there is none). */
function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.toLowerCase(); // e.g. "Dockerfile" -> "dockerfile"
  return base.slice(dot + 1).toLowerCase();
}

/** The lowercase basename of a path. */
function basenameOf(path: string): string {
  return (path.split('/').pop() ?? '').toLowerCase();
}

/**
 * Is this path worth showing Michael at all?
 *
 * Filters out vendored code, lock files, build output, binary assets and
 * minified bundles — all of which are noise at best and context-window poison
 * at worst.
 */
export function isInterestingPath(path: string): boolean {
  const segs = segments(path);
  for (const seg of segs.slice(0, -1)) {
    if (IGNORED_DIRS.has(seg)) return false;
  }
  const base = basenameOf(path);
  if (LOCK_FILES.has(base)) return false;
  if (base.endsWith('.min.js') || base.endsWith('.min.css') || base.endsWith('.map')) {
    return false;
  }
  const ext = extensionOf(path);
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true;
}

/**
 * How interesting is this file as prompt content? Higher is better.
 * 0 means "do not read the contents of this file".
 */
export function contentPriority(path: string): number {
  const base = basenameOf(path);
  const ext = extensionOf(path);
  if (!SOURCE_EXTENSIONS.has(ext)) return 0;

  const priorityIndex = PRIORITY_FILES.indexOf(base);
  if (priorityIndex >= 0) return 1000 - priorityIndex;

  const lower = path.toLowerCase();
  for (const hint of ENTRY_HINTS) {
    if (lower.includes(hint)) return 500;
  }
  // A config file next to the manifest is usually more useful than a leaf.
  if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml') return 200;
  return 100;
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

/**
 * Pull "owner" and "repo" out of a GitHub URL.
 *
 * Accepts https://github.com/owner/repo, the .git suffix, and the
 * git@github.com:owner/repo.git SSH form.
 */
export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  const m =
    repoUrl.match(/github\.com[/:]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i) ||
    repoUrl.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

/** A blob in a GitHub tree response. */
interface GithubTreeBlob {
  path: string;
  type: string;
  size?: number;
}

/**
 * Fetch the recursive file tree for a branch.
 *
 * `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` returns every
 * blob in the tree. GitHub sets `truncated: true` when the repo is too big
 * for one response, and we surface that honestly rather than pretending we
 * saw everything.
 */
async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<{ blobs: GithubTreeBlob[]; truncated: boolean } | null> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/git/trees/` +
    `${encodeURIComponent(branch)}?recursive=1`;

  const res = await fetch(url, {
    headers: githubAuthHeaders(token),
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    tree?: GithubTreeBlob[];
    truncated?: boolean;
  };
  const blobs = (data.tree || []).filter((t) => t.type === 'blob');
  return { blobs, truncated: !!data.truncated };
}

/**
 * Read one file's text.
 *
 * Asks for the raw media type so we get plain text back; falls back to
 * decoding the base64 payload GitHub returns for the JSON media type.
 * Returns null when the file cannot be read.
 */
async function fetchFileText(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/` +
    path.split('/').map(encodeURIComponent).join('/');

  const res = await fetch(url, {
    headers: {
      ...githubAuthHeaders(token),
      Accept: 'application/vnd.github.raw',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    // The raw media type was refused — decode the base64 payload instead.
    try {
      const data = (await res.json()) as {
        content?: string;
        encoding?: string;
      };
      if (typeof data.content === 'string' && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build a bounded snapshot of a repository for the prompt.
 *
 * Never throws. Every failure mode ends up in `notes` so the caller can tell
 * the user (and Michael) what went wrong instead of failing the request.
 *
 * @param includeContents When false, only the file tree is fetched — no
 *   per-file API calls. Callers that just need "what files exist" (Jim, for
 *   instance) should use this; it costs one request instead of a dozen.
 */
export async function buildRepoSnapshot(
  repoUrl: string | null,
  token: string | null,
  opts: { includeContents?: boolean } = {}
): Promise<RepoSnapshot> {
  const includeContents = opts.includeContents !== false;
  const empty: RepoSnapshot = {
    repoFullName: null,
    defaultBranch: null,
    paths: [],
    totalFiles: 0,
    treeTruncated: false,
    files: [],
    languages: '(unknown)',
    notes: [],
  };

  if (!repoUrl) {
    empty.notes.push('No GitHub repository is linked to this project.');
    return empty;
  }

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    empty.notes.push(`Could not understand the repository URL "${repoUrl}".`);
    return empty;
  }
  const { owner, repo } = parsed;
  empty.repoFullName = `${owner}/${repo}`;

  if (!token) {
    empty.notes.push(
      `${owner}/${repo} is linked, but GitHub is not connected for this account, ` +
        'so the code could not be read. Connect GitHub in Settings and regenerate.'
    );
    return empty;
  }

  // Resolve the default branch. Asking for the repo itself is one extra
  // request, but it is the only reliable way to get the branch name — the
  // project row does not store it and teams rename "main" all the time.
  let defaultBranch: string | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: githubAuthHeaders(token),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { default_branch?: string };
      defaultBranch = data.default_branch || null;
    } else if (res.status === 404) {
      empty.notes.push(
        `${owner}/${repo} could not be read — it may be private, or the connected ` +
          'GitHub account may not have access.'
      );
      return empty;
    } else if (res.status === 401) {
      empty.notes.push('The GitHub connection is no longer valid. Reconnect it in Settings.');
      return empty;
    }
  } catch {
    empty.notes.push('Could not reach GitHub to read the repository.');
    return empty;
  }

  if (!defaultBranch) defaultBranch = 'main';
  empty.defaultBranch = defaultBranch;

  // Pull the tree.
  let blobs: GithubTreeBlob[] = [];
  try {
    const tree = await fetchRepoTree(owner, repo, defaultBranch, token);
    if (!tree) {
      empty.notes.push(`Could not list the files in ${owner}/${repo}.`);
      return empty;
    }
    blobs = tree.blobs;
    empty.treeTruncated = tree.truncated;
    if (tree.truncated) {
      empty.notes.push(
        'This repository is large, so the file list Michael sees is only partial.'
      );
    }
  } catch {
    empty.notes.push('Could not reach GitHub to list the repository files.');
    return empty;
  }

  const interesting = blobs.filter((b) => isInterestingPath(b.path));
  empty.totalFiles = interesting.length;

  // Language summary across every interesting file.
  empty.languages = summarizeLanguages(interesting);

  // The tree itself, sorted for stability.
  const sortedPaths = interesting.map((b) => b.path).sort();
  empty.paths = sortedPaths.slice(0, MAX_TREE_PATHS);

  if (empty.totalFiles === 0) {
    empty.notes.push(`${owner}/${repo} has no source files Michael can read yet.`);
    return empty;
  }

  // A paths-only caller does not need the per-file requests at all.
  if (!includeContents) {
    return empty;
  }

  // Choose which files to actually read, highest priority first.
  const candidates = interesting
    .map((b) => ({ path: b.path, size: b.size ?? 0, score: contentPriority(b.path) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });

  let budget = MAX_TOTAL_CONTENT_CHARS;
  for (const candidate of candidates) {
    if (empty.files.length >= MAX_CONTENT_FILES) break;
    if (budget <= 0) break;
    // Skip files that are too big to be worth the budget.
    if (candidate.size > MAX_FILE_BYTES && candidate.score < 500) continue;

    let text: string | null = null;
    try {
      text = await fetchFileText(owner, repo, candidate.path, token);
    } catch {
      text = null;
    }
    if (text === null || text.trim().length === 0) continue;

    const truncated = text.length > MAX_CHARS_PER_FILE;
    const slice = truncated ? text.slice(0, MAX_CHARS_PER_FILE) : text;
    budget -= slice.length;

    empty.files.push({ path: candidate.path, content: slice, truncated });
  }

  if (empty.files.length === 0) {
    empty.notes.push(
      `Michael could not read the contents of any file in ${owner}/${repo}.`
    );
  }

  return empty;
}

/**
 * Summarize the stack from file extensions.
 *
 * "TypeScript (120), CSS (12)" is a cheap, high-signal hint for an LLM that
 * has to plan work across a codebase it has never seen.
 */
function summarizeLanguages(blobs: GithubTreeBlob[]): string {
  const counts = new Map<string, number>();
  for (const b of blobs) {
    const ext = extensionOf(b.path);
    if (!ext || !SOURCE_EXTENSIONS.has(ext)) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  if (counts.size === 0) return '(unknown)';

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return top.map(([ext, n]) => `${ext} (${n})`).join(', ');
}
