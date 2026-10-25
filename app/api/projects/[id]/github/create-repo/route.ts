import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildReauthResponseFromFetch,
  githubAuthHeaders,
  githubReauthResponse,
  getStoredGithubToken,
  isGithubAuthFailure,
} from '@/lib/github/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const body = await request.json()
    const { name, description, private: isPrivate = true } = body

    if (!projectId) {
      return NextResponse.json({ error: 'Missing project id' }, { status: 400 })
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Capture where the user is so we can round-trip them back here after
    // a re-auth. The Settings page sets this implicitly; for in-app calls
    // we read from the request body as a fallback.
    const returnTo =
      typeof body?.returnTo === 'string' && body.returnTo.startsWith('/')
        ? body.returnTo
        : `/projects/${projectId}`

    const { token } = await getStoredGithubToken(supabase, user.id)

    if (!token) {
      const r = githubReauthResponse(supabase, user.id, { kind: 'missing', returnTo })
      return NextResponse.json(r.body, { status: r.status })
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, description, team_id, owner_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: member, error: memberError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (memberError && memberError.code !== 'PGRST116') {
      return NextResponse.json({ error: 'Failed to verify membership' }, { status: 500 })
    }

    const isOwner = project.owner_id === user.id
    const isMember = member && ['owner', 'dev'].includes(member.role)

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Sanitize the repo name to match GitHub's rules:
    //   - 1–100 chars
    //   - lowercase alphanumerics, single hyphens, dots, underscores
    //   - cannot start or end with a special char
    //   - no consecutive dots/hyphens
    //   - cannot be "." or ".."
    const rawName = (name || project.name || '').toString().trim()
    const sanitized = rawName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')   // collapse runs of invalid chars into a single hyphen
      .replace(/^[._-]+/, '')            // strip leading special chars
      .replace(/[-._]+$/, '')            // strip trailing special chars
      .replace(/\.{2,}/g, '.')           // no consecutive dots
      .replace(/-{2,}/g, '-')            // no consecutive hyphens
      .slice(0, 100)

    const repoName =
      sanitized && sanitized !== '.' && sanitized !== '..'
        ? sanitized
        : 'dave-project'

    // GitHub caps descriptions at 350 chars; longer values return 422.
    const repoDescription = (
      description ||
      project.description ||
      'Created by DAVE'
    )
      .toString()
      .slice(0, 350)

    const githubRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        ...githubAuthHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repoName,
        description: repoDescription,
        private: isPrivate,
        auto_init: true,
      }),
    })

    if (!githubRes.ok) {
      // GitHub returns JSON error payloads — parse them so the user sees a
      // helpful message instead of "Unprocessable Entity".
      const errorBody: { message?: string; errors?: { field?: string; message?: string; code?: string }[] } | null =
        await githubRes.json().catch(() => null)
      const errorText = errorBody?.message || (await githubRes.text().catch(() => ''))
      const fieldErrors: string[] = (errorBody?.errors ?? [])
        .map((e) => e.message)
        .filter((m): m is string => typeof m === 'string' && m.length > 0)
      const detailedMessage =
        fieldErrors.length > 0
          ? `${errorText || 'GitHub rejected the request'} — ${fieldErrors.join('; ')}`
          : errorText || githubRes.statusText || 'Unknown GitHub error'

      console.error('GitHub API error:', githubRes.status, repoName, errorBody ?? errorText)

      const rateLimited =
        githubRes.status === 403 &&
        (githubRes.headers.get('x-ratelimit-remaining') === '0' ||
          /rate limit/i.test(errorText))

      if (rateLimited) {
        return NextResponse.json(
          {
            code: 'GITHUB_RATE_LIMIT',
            error: 'GitHub rate limit exceeded. Please try again later.',
          },
          { status: 403 }
        )
      }

      // 422: validation failed. Most often this is a name collision
      // ("name already exists on this account") or an invalid name format.
      // Surface the field-level error so the user knows what to fix.
      if (githubRes.status === 422) {
        const alreadyExists =
          (errorText && /already exists/i.test(errorText)) ||
          fieldErrors.some((m) => /already exists/i.test(m))
        return NextResponse.json(
          {
            code: alreadyExists ? 'REPO_NAME_TAKEN' : 'GITHUB_VALIDATION_FAILED',
            error: alreadyExists
              ? `A repository named "${repoName}" already exists on your GitHub account. Pick a different name.`
              : detailedMessage,
            fieldErrors,
          },
          { status: 422 }
        )
      }

      // 401 (bad credentials) or 403 (revoked access / insufficient scope)
      // means the stored token is no longer usable. Clear it so the Settings
      // page reflects reality, and tell the caller to reconnect.
      if (isGithubAuthFailure(githubRes, errorBody ?? errorText)) {
        const r = await buildReauthResponseFromFetch(supabase, user.id, githubRes, {
          returnTo,
          body: errorBody ?? errorText,
        })
        if (r) return NextResponse.json(r.body, { status: r.status })
      }

      return NextResponse.json(
        { error: `GitHub API error: ${detailedMessage}` },
        { status: githubRes.status }
      )
    }

    const repo = await githubRes.json()
    const repoUrl = repo.html_url || repo.url

    const { error: updateError } = await supabase
      .from('projects')
      .update({ repo_url: repoUrl })
      .eq('id', projectId)

    if (updateError) {
      console.error('Failed to update project repo_url:', updateError)
      return NextResponse.json({ error: 'Repo created but failed to update project' }, { status: 500 })
    }

    return NextResponse.json({ repo_url: repoUrl })
  } catch (err: any) {
    console.error('Unexpected error in create-repo:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}