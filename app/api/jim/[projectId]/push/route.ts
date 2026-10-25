import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  buildReauthResponseFromFetch,
  githubAuthHeaders,
  githubReauthResponse,
  getStoredGithubToken,
  isGithubAuthFailure,
} from '@/lib/github/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const returnTo =
      typeof body?.returnTo === 'string' && body.returnTo.startsWith('/')
        ? body.returnTo
        : `/projects/${projectId}`;

    const { token } = await getStoredGithubToken(supabase, user.id);

    if (!token) {
      const r = githubReauthResponse(supabase, user.id, { kind: 'missing', returnTo });
      return NextResponse.json(r.body, { status: r.status });
    }

    // Get project details
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, repo_url, owner_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.repo_url) {
      return NextResponse.json(
        { error: 'No GitHub repo linked. Create one first.' },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    const isOwner = project.owner_id === user.id;
    const isMember = member && ['owner', 'dev'].includes(member.role);

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { files, message = 'Add files from Jim', branch = 'main' } = body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Extract owner/repo from repo_url
    const repoUrl = project.repo_url;
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      return NextResponse.json({ error: 'Invalid GitHub repo URL' }, { status: 400 });
    }
    const [, owner, repo] = match;

    // Push each file to GitHub
    const results = [];
    for (const file of files) {
      const { path, content } = file;
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

      // Check if file exists (to get SHA for update)
      let existingSha: string | undefined;
      const existingRes = await fetch(apiUrl, {
        headers: githubAuthHeaders(token),
      });
      if (existingRes.ok) {
        const existing = await existingRes.json();
        existingSha = existing.sha;
      } else {
        const existingBody = await safeJson(existingRes);
        if (isGithubAuthFailure(existingRes, existingBody)) {
          // Short-circuit: the token is dead, no point burning the rest of
          // the loop. Return the standard reauth response.
          const r = await buildReauthResponseFromFetch(supabase, user.id, existingRes, {
            returnTo,
            body: existingBody,
          });
          if (r) return NextResponse.json(r.body, { status: r.status });
        }
      }

      // Create or update file
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          ...githubAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          content: Buffer.from(content).toString('base64'),
          branch,
          sha: existingSha,
        }),
      });

      if (!res.ok) {
        const resBody = await safeJson(res);
        if (isGithubAuthFailure(res, resBody)) {
          const r = await buildReauthResponseFromFetch(supabase, user.id, res, {
            returnTo,
            body: resBody,
          });
          if (r) return NextResponse.json(r.body, { status: r.status });
        }
        const errorText = await res.text();
        results.push({ path, success: false, error: errorText });
      } else {
        const data = await res.json();
        results.push({ path, success: true, sha: data.content?.sha });
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error('Push to repo error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * Best-effort JSON parse that never throws. We reuse the response for the
 * subsequent isGithubAuthFailure check, so cloning the body is important —
 * `res.json()` consumes the body and a second call would reject.
 */
async function safeJson(res: Response): Promise<unknown> {
  try {
    // `clone()` so the original body stays untouched for any later caller.
    return await res.clone().json();
  } catch {
    return null;
  }
}