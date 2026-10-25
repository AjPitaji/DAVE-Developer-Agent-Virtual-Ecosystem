/**
 * Server-side GitHub auth helpers.
 *
 * Why this exists
 * ---------------
 * DAVE stores each user's GitHub OAuth access token in `profiles.github_token`.
 * GitHub's user-to-server OAuth tokens (the kind our OAuth App flow returns)
 * do NOT expire automatically and cannot be refreshed server-side — when a
 * token stops working it's because the user revoked the connection from
 * GitHub, the OAuth app secret was rotated, or GitHub invalidated the token
 * after a security event. The only remedy is a full re-authorization.
 *
 * Previously, the only response to a 401 was to null the stored token and
 * tell the user "go to Settings, disconnect, reconnect" — which is annoying
 * and easy to forget. This module centralizes three things every GitHub
 * call needs:
 *
 *   1. Fetch the current token for a user.
 *   2. Detect a "token is no longer accepted by GitHub" response.
 *   3. Clear the stale token + emit a structured `GITHUB_REAUTH_REQUIRED`
 *      error so the caller can return a machine-readable response that
 *      includes the OAuth authorize URL. The UI uses that to show a
 *      one-click "Reconnect GitHub" button instead of a dead-end error.
 *
 * We deliberately avoid @octokit/* to keep the dependency surface small;
 * the helpers below work with the raw `fetch` calls already in the codebase.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Result codes used across route handlers + the UI. */
export const GITHUB_REAUTH_REQUIRED = 'GITHUB_REAUTH_REQUIRED' as const;
export const GITHUB_NOT_CONNECTED = 'GITHUB_NOT_CONNECTED' as const;

/**
 * Where the UI should send the user to start (or restart) the OAuth flow.
 * Lives in a single helper so the URL stays consistent — the route file
 * is the one place that knows the callback path.
 */
export function buildAuthorizeUrl(returnTo?: string): string {
  const base = '/api/auth/github/authorize';
  if (!returnTo) return base;
  const params = new URLSearchParams({ return_to: returnTo });
  return `${base}?${params.toString()}`;
}

/**
 * Shape of the structured response every GitHub route should return when
 * the stored token is missing or has been invalidated. The UI keys off
 * `code` to know which banner to render, and off `authorizeUrl` to render
 * the right CTA.
 */
export interface GithubReauthError {
  code: typeof GITHUB_REAUTH_REQUIRED | typeof GITHUB_NOT_CONNECTED;
  error: string;
  authorizeUrl: string;
}

/**
 * Read the user's stored GitHub access token. Returns `null` if the user
 * has never connected GitHub. Throws nothing — the caller decides whether
 * "no token" is fatal.
 */
export async function getStoredGithubToken(
  supabase: SupabaseClient,
  userId: string
): Promise<{ token: string | null; githubUsername: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('github_token, github_username')
    .eq('id', userId)
    .single();

  if (error) {
    // PGRST116 = no row, which can't really happen for a logged-in user
    // but we treat it the same as "no token" so the UI can prompt.
    if (error.code !== 'PGRST116') {
      console.error('Failed to load GitHub token from profile:', error);
    }
    return { token: null, githubUsername: null };
  }

  return {
    token: (data?.github_token as string | null) ?? null,
    githubUsername: (data?.github_username as string | null) ?? null,
  };
}

/**
 * Clear the stored token for a user. Called when GitHub rejects the token
 * so the Settings page reflects reality (instead of showing "Connected"
 * with a dead token). Failures are logged but never thrown — losing this
 * write doesn't affect the current request.
 */
export async function clearStoredGithubToken(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ github_token: null })
    .eq('id', userId);
  if (error) {
    console.error('Failed to clear stale GitHub token:', error);
  }
}

/**
 * Make a cheap, side-effect-free GitHub API call that proves it's still
 * accepted by the server. We use `GET /user` (no scope, no rate-limit cost
 * beyond a single authenticated request) and treat anything other than a
 * 200 as "not valid". 200 → valid; 403/401 → token revoked or app removed;
 * 5xx → transient, we report it as "unknown" so the UI doesn't trigger
 * an unnecessary re-auth.
 *
 * Used by `GET /api/auth/github/status` so the Settings page can warn the
 * user *before* they trigger Dwight / Jim / repo-create / PR-link.
 */
export async function probeGithubToken(
  token: string
): Promise<'valid' | 'invalid' | 'unknown'> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: githubAuthHeaders(token),
      // We never want a cached response to mask a real 401.
      cache: 'no-store',
    });
    if (res.ok) return 'valid';
    // 401 / 403 with our token specifically means the token is bad —
    // GitHub returns 403 (with a "Bad credentials" message) for both
    // revoked tokens and missing scopes, which is exactly what we want
    // to detect here.
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unknown';
  } catch (err) {
    // Network blip, DNS failure, etc. — we don't want a fluke to force
    // the user through a full OAuth dance.
    console.warn('GitHub probe failed:', err);
    return 'unknown';
  }
}

/**
 * Standard Authorization headers for GitHub REST calls. Centralised so
 * every route emits the same Accept / API version (the v2022-11-28
 * header pins us to the modern response shape — without it GitHub will
 * eventually drop support).
 *
 * Note: GitHub accepts both `Bearer …` and `token …`; we use `Bearer`
 * for OAuth consistency with the rest of the codebase. If the OAuth App
 * is ever swapped for a GitHub App, the same header still works.
 */
export function githubAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Inspect a GitHub API response and decide whether the failure means
 * "this token is dead" (clear it + signal re-auth) vs "something else
 * is wrong" (let the caller surface the original error).
 *
 * We treat 401 as a dead token. 403 is trickier — it can be a bad token
 * OR a rate-limit / permission issue. We look for `Bad credentials` /
 * `token expired` / `token revoked` in the message body to disambiguate.
 * A plain 403 (e.g. "Resource not accessible by integration") is not a
 * re-auth case, so we leave it alone.
 */
export function isGithubAuthFailure(res: Response, body?: unknown): boolean {
  if (res.status === 401) return true;
  if (res.status === 403) {
    // GitHub's "this token won't work" messages are stable strings.
    // Anything else (rate limit, missing scope, org block) is not a
    // re-auth case and the caller should surface the original error.
    const text = extractMessage(body) ?? res.statusText ?? '';
    return /bad credentials|token (?:expired|revoked|not accepted)/i.test(text);
  }
  return false;
}

function extractMessage(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return null;
}

/**
 * Build the standardized `GITHUB_REAUTH_REQUIRED` response payload for a
 * route that has just confirmed the stored token is bad. The shape is the
 * same whether the token was missing entirely or was rejected by GitHub,
 * but the message and status code differ so the UI can be specific.
 */
export function githubReauthResponse(
  supabase: SupabaseClient,
  userId: string,
  opts: { kind: 'missing' | 'invalid'; returnTo?: string; detail?: string }
): { status: number; body: GithubReauthError } {
  if (opts.kind === 'invalid') {
    // Fire-and-forget: clear the dead token so Settings stops lying about
    // it being connected. We don't await — the request is already on its
    // way out the door and a write failure here is purely cosmetic.
    void clearStoredGithubToken(supabase, userId);
  }
  const message =
    opts.kind === 'missing'
      ? 'GitHub is not connected. Connect your GitHub account to continue.'
      : `Your GitHub connection is no longer valid (${opts.detail ?? 'Unauthorized'}). Reconnect your GitHub account to continue.`;
  return {
    status: opts.kind === 'missing' ? 400 : 401,
    body: {
      code: opts.kind === 'missing' ? GITHUB_NOT_CONNECTED : GITHUB_REAUTH_REQUIRED,
      error: message,
      authorizeUrl: buildAuthorizeUrl(opts.returnTo),
    },
  };
}

/**
 * Convenience helper: turn a thrown error from `fetch` into the same
 * structured response. The most common caller pattern is:
 *
 *     const res = await fetch(...);
 *     if (isGithubAuthFailure(res, body)) {
 *       const r = githubReauthResponse(supabase, userId, { kind: 'invalid', returnTo });
 *       return NextResponse.json(r.body, { status: r.status });
 *     }
 *     if (!res.ok) { ... }
 */
export async function buildReauthResponseFromFetch(
  supabase: SupabaseClient,
  userId: string,
  res: Response,
  opts: { returnTo?: string; body?: unknown }
): Promise<{ status: number; body: GithubReauthError } | null> {
  if (!isGithubAuthFailure(res, opts.body)) return null;
  const detail = extractMessage(opts.body) ?? res.statusText ?? `HTTP ${res.status}`;
  return githubReauthResponse(supabase, userId, {
    kind: 'invalid',
    returnTo: opts.returnTo,
    detail,
  });
}