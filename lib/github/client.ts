/**
 * Client-side helpers for the GitHub OAuth re-authentication flow.
 *
 * Why this exists
 * ---------------
 * GitHub OAuth user tokens don't expire on a timer and can't be refreshed
 * server-side. When a token stops working (user revoked access, app
 * reinstalled, OAuth secret rotated), the only fix is a fresh
 * authorization round-trip — which requires user interaction in the
 * browser. So the UX we can offer is "detect → ask → re-auth → retry",
 * and these helpers exist to make that loop one-line for the caller.
 *
 * Flow at a glance:
 *
 *   1. Caller invokes a GitHub-backed action (Dwight review, repo
 *      creation, PR link, …).
 *   2. Server responds with `code: 'GITHUB_REAUTH_REQUIRED'` and
 *      `authorizeUrl`.
 *   3. `triggerReauth({ returnTo, onComplete })` is called.
 *   4. The current path is stashed in sessionStorage and the browser is
 *      redirected to the OAuth authorize URL.
 *   5. After the user re-consents on github.com, GitHub redirects back
 *      to /api/auth/github/callback which writes the new token and
 *      redirects to `returnTo`.
 *   6. The Settings page / project page calls `consumeRetry()` on mount
 *      and — if a retry was queued — replays the original action.
 *
 * The `pendingReauth` sessionStorage key is small and self-contained;
 * it's purged after one read so reloads don't replay twice.
 */
import { GITHUB_REAUTH_REQUIRED } from '@/lib/github/server';

const STORAGE_KEY = 'dave.githubReauth';

/**
 * Shape of the payload stashed in sessionStorage while the user is in the
 * middle of a re-auth round trip. Stored only as JSON; nothing sensitive.
 */
export interface PendingReauth {
  /** Where the user was when the failure happened. Becomes `returnTo`. */
  returnTo: string;
  /** Human-readable label for UI ("Run Dwight", "Create repo", …). */
  action: string;
  /** Milliseconds since epoch when we queued this — useful for debugging. */
  queuedAt: number;
}

/**
 * Sniff a fetch Response / JSON body to decide whether the server told us
 * to reconnect GitHub. Two codes are accepted: the new
 * `GITHUB_REAUTH_REQUIRED` (token existed but is no longer accepted) and
 * the legacy `GITHUB_NOT_CONNECTED` (no token at all). Both surface the
 * same UX in the app today.
 */
export function isGithubReauthResponse(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const code = (body as { code?: unknown }).code;
  return code === GITHUB_REAUTH_REQUIRED || code === 'GITHUB_NOT_CONNECTED';
}

export interface GithubReauthPayload {
  code: typeof GITHUB_REAUTH_REQUIRED | 'GITHUB_NOT_CONNECTED';
  error: string;
  authorizeUrl: string;
}

export function extractGithubReauth(body: unknown): GithubReauthPayload | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Partial<GithubReauthPayload>;
  if (
    (b.code === GITHUB_REAUTH_REQUIRED || b.code === 'GITHUB_NOT_CONNECTED') &&
    typeof b.error === 'string' &&
    typeof b.authorizeUrl === 'string'
  ) {
    return { code: b.code, error: b.error, authorizeUrl: b.authorizeUrl };
  }
  return null;
}

/**
 * Extract the OAuth reauth URL from a fetch `Response`. Returns `null`
 * if the response isn't a structured reauth payload.
 */
export async function readReauthFromResponse(
  res: Response
): Promise<GithubReauthPayload | null> {
  // Drain the body once; we need it for the JSON shape.
  let parsed: unknown = null;
  try {
    parsed = await res.clone().json();
  } catch {
    return null;
  }
  return extractGithubReauth(parsed);
}

/**
 * Kick off a GitHub re-auth round trip. The current path is preserved in
 * sessionStorage (and forwarded to the server as `return_to`) so the user
 * lands back on the same screen after GitHub redirects them to our
 * callback. `onComplete` is invoked synchronously with the queued
 * payload so callers can replay their original action immediately after
 * the round trip.
 *
 * We use `window.location.assign` rather than `href =` so a popup-blocker
 * scenario still navigates. This is a real top-level redirect.
 */
export function triggerReauth(opts: {
  /** Where to send the user after re-auth. Defaults to current path. */
  returnTo?: string;
  /** Short label used by the modal / banner ("Dwight review", "Push files"). */
  action: string;
  /**
   * Optional callback fired *before* the redirect so callers can show a
   * "redirecting to GitHub…" toast. Defaults to a no-op.
   */
  onRedirect?: () => void;
}): void {
  if (typeof window === 'undefined') return;
  const returnTo = sanitizePath(opts.returnTo ?? window.location.pathname + window.location.search);
  const payload: PendingReauth = {
    returnTo,
    action: opts.action,
    queuedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw in private modes / quota-exceeded; the
    // fallback is to just append a query param so the post-redirect
    // detection still works.
  }
  opts.onRedirect?.();
  // The server-provided authorize URL already includes the return_to
  // query string when the route appended it. Strip ours and re-derive
  // so the helper stays self-contained — callers can pass either an
  // already-built URL or rely on the default path.
  //
  // We use a full-page redirect (window.location.assign) rather than
  // next/navigation because the OAuth flow has to round-trip through
  // github.com, which only works with a top-level browser navigation.
  // The Next.js eslint rule that fires on this line is a false positive
  // for cross-origin round trips like OAuth.
  const authorizeUrl =
    `/api/auth/github/authorize?return_to=${encodeURIComponent(returnTo)}`;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(authorizeUrl);
}

/**
 * Read-and-clear the queued retry (if any). Call from `useEffect` on
 * mount of every page that might trigger a GitHub action so the original
 * action can be replayed automatically after re-auth.
 *
 * The cleared-on-read semantics mean a refresh of the same page won't
 * replay twice — once the user re-consents and lands back, we either run
 * the retry or we don't.
 */
export function consumeRetry(): PendingReauth | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as PendingReauth;
    if (parsed && typeof parsed.returnTo === 'string' && typeof parsed.action === 'string') {
      return parsed;
    }
  } catch {
    // Malformed payload — drop it.
  }
  return null;
}

/**
 * Clear any pending retry without consuming it. Useful when the user
 * explicitly cancels the modal: we don't want a phantom retry on their
 * next visit.
 */
export function cancelRetry(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Lightweight wrapper used by UI code to handle a 401-ish response in
 * one place. Returns `true` if the response was a reauth payload (the
 * caller is then expected to render the modal / banner); `false` if the
 * caller should surface the original error as-is.
 */
export async function handleGithubResponse(
  res: Response,
  fallbackMessage: string
): Promise<{ needsReauth: boolean; reauth: GithubReauthPayload | null; message: string }> {
  if (!res.ok) {
    const reauth = await readReauthFromResponse(res);
    if (reauth) {
      return { needsReauth: true, reauth, message: reauth.error };
    }
    // Best-effort error message — fall back to statusText if the body
    // isn't a JSON `{ error: string }`.
    try {
      const body = (await res.clone().json()) as { error?: unknown };
      return {
        needsReauth: false,
        reauth: null,
        message: typeof body?.error === 'string' ? body.error : fallbackMessage,
      };
    } catch {
      return { needsReauth: false, reauth: null, message: fallbackMessage };
    }
  }
  return { needsReauth: false, reauth: null, message: '' };
}

function sanitizePath(value: string): string {
  // Defense in depth: `authorize` whitelists relative paths server-side,
  // but we don't want to send something obviously bogus like `//evil`.
  if (!value || typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}