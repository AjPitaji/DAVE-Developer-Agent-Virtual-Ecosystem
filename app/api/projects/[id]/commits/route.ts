import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  buildReauthResponseFromFetch,
  getStoredGithubToken,
  githubReauthResponse,
  isGithubAuthFailure,
} from '@/lib/github/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

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

    const returnTo = `/projects/${projectId}`

    const { token } = await getStoredGithubToken(supabase, user.id)

    if (!token) {
      const r = githubReauthResponse(supabase, user.id, { kind: 'missing', returnTo })
      return NextResponse.json(r.body, { status: r.status })
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, repo_url, owner_id, team_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()

    const isOwner = project.owner_id === user.id
    const isMember = !!member && ['owner', 'dev'].includes(member.role)

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!project.repo_url) {
      return NextResponse.json(
        { error: 'No GitHub repo linked to this project.' },
        { status: 400 }
      )
    }

    const repoMatch = project.repo_url.match(
      /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
    )
    if (!repoMatch) {
      return NextResponse.json({ error: 'Project repo URL is malformed.' }, { status: 400 })
    }
    const [, owner, repo] = repoMatch

    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        cache: 'no-store',
      }
    )

    if (!ghRes.ok) {
      const body = await ghRes.json().catch(() => null)
      if (isGithubAuthFailure(ghRes, body)) {
        const r = await buildReauthResponseFromFetch(supabase, user.id, ghRes, {
          returnTo,
          body,
        })
        if (r) return NextResponse.json(r.body, { status: r.status })
      }
      return NextResponse.json(
        { error: `GitHub API error: ${ghRes.status}` },
        { status: ghRes.status }
      )
    }

    const raw = (await ghRes.json()) as any[]

    const commits = raw.map((c) => {
      const message = (c?.commit?.message ?? '').toString()
      const subject = message.split('\n')[0].trim()
      const authorName =
        c?.author?.login ||
        c?.commit?.author?.name ||
        'Unknown'
      const date = c?.commit?.author?.date || c?.commit?.committer?.date || null
      return {
        sha: c.sha as string,
        shortSha: (c.sha as string).slice(0, 7),
        message: subject,
        fullMessage: message,
        author: authorName,
        avatarUrl: c?.author?.avatar_url ?? null,
        date,
        url: c?.html_url ?? null,
      }
    })

    const authors = Array.from(new Set(commits.map((c) => c.author)))
    const lastCommitDate = commits[0]?.date ?? null
    const firstCommitDate = commits[commits.length - 1]?.date ?? null

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentCount = commits.filter((c) => {
      if (!c.date) return false
      return new Date(c.date).getTime() >= sevenDaysAgo
    }).length

    return NextResponse.json({
      commits,
      summary: {
        total: commits.length,
        authors: authors.length,
        authorNames: authors,
        firstCommitDate,
        lastCommitDate,
        recentCount,
        hasMore: commits.length === 50,
      },
    })
  } catch (err: any) {
    console.error('Unexpected error in commits route:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
