import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildAuthorizeUrl,
  getStoredGithubToken,
  probeGithubToken,
} from '@/lib/github/server';

/**
 * GET /api/auth/github/status
 *
 * Lightweight probe used by the Settings page + every UI flow that needs
 * GitHub (Dwight, Jim, repo-create, PR-link). Returns:
 *
 *   {
 *     connected: boolean,         // a token exists in the profile row
 *     valid: boolean,             // GitHub accepted the token on a probe call
 *     githubUsername: string|null,// cached for the UI
 *     authorizeUrl: string        // one-click OAuth re-auth URL
 *   }
 *
 * We deliberately keep this endpoint cheap — it hits GitHub only when the
 * user is actually on the Settings page or has just kicked off an action
 * that requires GitHub. The Settings page calls it on mount to warn about
 * stale tokens before the user tries to use one.
 *
 * Auth: requires a logged-in user. Without a session we 401 — there's
 * nothing to validate otherwise.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    // The settings page passes the current path so the OAuth callback
    // can drop the user back here after they re-auth.
    const returnTo = url.searchParams.get('return_to') ?? undefined;

    const { token, githubUsername } = await getStoredGithubToken(supabase, user.id);
    const connected = !!token;
    let valid = false;
    if (token) {
      const probe = await probeGithubToken(token);
      valid = probe === 'valid';
    }

    return NextResponse.json({
      connected,
      valid,
      githubUsername,
      authorizeUrl: buildAuthorizeUrl(returnTo),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to check GitHub status';
    console.error('GitHub status check failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST is accepted as an alias so client code can use a single
 * `triggerReauth()` POST helper regardless of whether it needs to
 * validate or just look up the reauth URL.
 */
export const POST = GET;