/**
 * Searching public GitHub for projects that do something similar.
 *
 * This is what powers Pam: "has anyone already built this?" The two search
 * endpoints that matter are:
 *
 *   - `/search/repositories` — finds whole projects. Works unauthenticated
 *     (10 req/min) or authenticated (30 req/min). This is the primary signal.
 *   - `/search/code` — finds a specific *pattern* inside code, which answers
 *     "has anyone implemented this technique?" rather than "is there a project
 *     for this?". Requires authentication, so it is best-effort only.
 *
 * Everything here is read-only and public-only: private repositories the
 * caller's token can see are filtered out, and forks are excluded because
 * they are almost never what someone is looking for.
 */

/** A public repository, normalized to what the UI needs. */
export interface GithubRepo {
  fullName: string;
  url: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  pushedAt: string | null;
  license: string | null;
}

/**
 * The outcome of one search.
 *
 * A `warning` means the query itself did not work (bad syntax, rate limit).
 * An empty `repos` with no warning genuinely means "nothing matched" — the
 * two are very different and Pam says so differently.
 */
export interface GithubSearchOutcome {
  repos: GithubRepo[];
  warning: string | null;
}

const API = 'https://api.github.com';

function buildHeaders(token: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DAVE-app',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Turn a GitHub response into either a warning or a list of repos.
 *
 * The two failure modes people care about:
 *   - 403 + rate limit  → "search quota used up, try again shortly"
 *   - 422               → "GitHub rejected this query" (usually the LLM
 *                         produced a query with unbalanced quotes)
 */
async function readSearchResponse(
  res: Response
): Promise<{ repos: GithubRepo[]; warning: string | null }> {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0' || res.status === 429) {
      return {
        repos: [],
        warning:
          'GitHub search rate limit reached. Wait a minute and ask Pam again, or connect GitHub in Settings for a higher limit.',
      };
    }
    return {
      repos: [],
      warning: 'GitHub refused this search (403). Try rephrasing the question.',
    };
  }

  if (res.status === 422) {
    return {
      repos: [],
      warning: 'GitHub rejected one of the search queries as invalid.',
    };
  }

  if (res.status === 401) {
    return {
      repos: [],
      warning:
        'The connected GitHub token is no longer valid. Reconnect it in Settings.',
    };
  }

  if (!res.ok) {
    return {
      repos: [],
      warning: `GitHub search failed (HTTP ${res.status}).`,
    };
  }

  let data: { items?: unknown[] };
  try {
    data = (await res.json()) as { items?: unknown[] };
  } catch {
    return { repos: [], warning: 'Could not parse the GitHub search response.' };
  }

  const repos: GithubRepo[] = [];
  for (const item of data.items || []) {
    const normalized = normalizeRepo(item);
    if (normalized) repos.push(normalized);
  }
  return { repos, warning: null };
}

/**
 * Normalize one search hit.
 *
 * Returns null for anything we should not show: private repos (the caller
 * asked for public ones), forks (noise), and entries with no name.
 */
function normalizeRepo(raw: unknown): GithubRepo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.private === true) return null;
  if (r.fork === true) return null;

  const fullName = typeof r.full_name === 'string' ? r.full_name : null;
  if (!fullName) return null;

  const owner =
    typeof r.owner === 'object' && r.owner !== null
      ? String((r.owner as Record<string, unknown>).login ?? fullName.split('/')[0])
      : fullName.split('/')[0];

  const topics = Array.isArray(r.topics)
    ? r.topics.filter((t): t is string => typeof t === 'string').slice(0, 8)
    : [];

  return {
    fullName,
    url: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${fullName}`,
    owner,
    description: typeof r.description === 'string' ? r.description : null,
    language: typeof r.language === 'string' ? r.language : null,
    stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    forks: typeof r.forks_count === 'number' ? r.forks_count : 0,
    topics,
    pushedAt:
      typeof r.pushed_at === 'string'
        ? r.pushed_at
        : typeof r.updated_at === 'string'
        ? r.updated_at
        : null,
    license:
      typeof r.license === 'object' && r.license !== null
        ? String((r.license as Record<string, unknown>).spdx_id ?? '') || null
        : null,
  };
}

/**
 * Search public repositories.
 *
 * `sort` maps to GitHub's own ordering: `stars` (most popular first) is the
 * right default for "show me the best-known examples of this".
 */
export async function searchRepositories(
  query: string,
  opts: { token?: string | null; perPage?: number; sort?: 'stars' | 'updated' | 'best-match' } = {}
): Promise<GithubSearchOutcome> {
  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 30);
  const sort = opts.sort ?? 'stars';

  const params = new URLSearchParams({
    q: query,
    per_page: String(perPage),
  });
  if (sort !== 'best-match') {
    params.set('sort', sort);
    params.set('order', 'desc');
  }

  try {
    const res = await fetch(`${API}/search/repositories?${params.toString()}`, {
      headers: buildHeaders(opts.token ?? null),
      cache: 'no-store',
    });
    return await readSearchResponse(res);
  } catch {
    return {
      repos: [],
      warning: 'Could not reach GitHub to run the search.',
    };
  }
}

/**
 * Search public code.
 *
 * Returns the repositories the code hits live in, so they can be presented
 * the same way as repository results. Requires an authenticated token —
 * without one GitHub rejects the request, and we degrade to "no results"
 * rather than an error.
 */
export async function searchCode(
  query: string,
  opts: { token?: string | null; perPage?: number } = {}
): Promise<GithubSearchOutcome> {
  if (!opts.token) {
    return { repos: [], warning: null };
  }

  const perPage = Math.min(Math.max(opts.perPage ?? 10, 1), 30);
  const params = new URLSearchParams({ q: query, per_page: String(perPage) });

  try {
    const res = await fetch(`${API}/search/code?${params.toString()}`, {
      headers: buildHeaders(opts.token),
      cache: 'no-store',
    });

    if (!res.ok) {
      const outcome = await readSearchResponse(res);
      return { repos: [], warning: outcome.warning };
    }

    let data: { items?: unknown[] };
    try {
      data = (await res.json()) as { items?: unknown[] };
    } catch {
      return { repos: [], warning: null };
    }

    // A code hit is { path, repository: { full_name, ... } } — the repo is
    // nested, unlike a repository-search hit.
    const repos: GithubRepo[] = [];
    for (const item of data.items || []) {
      if (!item || typeof item !== 'object') continue;
      const nested = (item as Record<string, unknown>).repository;
      if (!nested || typeof nested !== 'object') continue;
      const normalized = normalizeRepo(nested);
      if (normalized) repos.push(normalized);
    }
    return { repos, warning: null };
  } catch {
    return { repos: [], warning: null };
  }
}

/**
 * Merge results from several searches, keeping the best-known version of
 * each repository and preserving a stable order (most stars first).
 */
export function mergeRepos(groups: GithubRepo[][]): GithubRepo[] {
  const byName = new Map<string, GithubRepo>();
  for (const group of groups) {
    for (const repo of group) {
      const existing = byName.get(repo.fullName);
      if (!existing) {
        byName.set(repo.fullName, repo);
      } else {
        // Keep the richer record, but take the higher star count.
        byName.set(repo.fullName, {
          ...existing,
          ...repo,
          stars: Math.max(existing.stars, repo.stars),
          topics: existing.topics.length >= repo.topics.length ? existing.topics : repo.topics,
          description: existing.description ?? repo.description,
          language: existing.language ?? repo.language,
        });
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.stars - a.stars);
}
