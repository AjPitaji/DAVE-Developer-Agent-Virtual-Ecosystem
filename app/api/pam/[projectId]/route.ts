import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pamResearch } from '@/lib/agents/pam';
import { getStoredGithubToken } from '@/lib/github/server';

/** Longest question we accept. */
const MAX_QUESTION_LENGTH = 500;

/**
 * Pam — "has anyone already built this?"
 *
 * Searches public GitHub for projects that do something similar to what the
 * team is asking about, and returns the closest matches with a short reason
 * for each.
 *
 * The developer's GitHub token is used when it is available, because
 * authenticated search has a higher rate limit and can also search code.
 * Without it the repository search still works (unauthenticated), just more
 * slowly. Results are always public repositories only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, name, description, team_id, repo_url, owner_id')
      .eq('id', projectId)
      .single();
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

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

    const body = await request.json().catch(() => ({}));
    const question =
      typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return NextResponse.json(
        { error: 'Ask Pam a question first.' },
        { status: 400 }
      );
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { error: `That question is too long — keep it under ${MAX_QUESTION_LENGTH} characters.` },
        { status: 400 }
      );
    }

    // Optional: a connected GitHub account means better search limits and
    // code search. It is not required.
    const { token } = await getStoredGithubToken(supabase, user.id);

    const result = await pamResearch(
      {
        question,
        projectName: project.name,
        projectDescription: project.description,
        repoUrl: project.repo_url,
      },
      token
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Pam could not complete the search';
    console.error('Pam research error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
