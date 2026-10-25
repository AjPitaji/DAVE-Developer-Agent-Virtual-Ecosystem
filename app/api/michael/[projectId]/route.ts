import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { michaelProposeTasks, MichaelContext } from '@/lib/agents/michael';
import { buildRepoSnapshot } from '@/lib/github/repo';
import { getStoredGithubToken } from '@/lib/github/server';

/** Longest additional prompt we accept. Anything bigger is a mistake. */
const MAX_PROMPT_CHARS = 4000;

/**
 * Load the project and confirm the caller may use it.
 *
 * Returns null when the project does not exist OR when the caller is not a
 * member of it — the route treats both the same way so we never leak the
 * existence of someone else's project.
 */
async function authorizeProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string
) {
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, team_id, repo_url, deadline, owner_id')
    .eq('id', projectId)
    .single();
  if (!project) return null;

  const { data: member } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  const isOwner = project.owner_id === userId;
  const isMember = member && ['owner', 'dev'].includes(member.role);
  if (!isOwner && !isMember) return null;

  return project;
}

/** The team's saved brief for Michael, or an empty string. */
async function readStoredPrompt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<string> {
  const { data } = await supabase
    .from('project_michael_settings')
    .select('prompt')
    .eq('project_id', projectId)
    .maybeSingle();
  return (data?.prompt as string | null) ?? '';
}

/** Persist the team's brief for Michael. */
async function savePrompt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string,
  prompt: string
): Promise<boolean> {
  const trimmed = prompt.trim().slice(0, MAX_PROMPT_CHARS);
  const { error } = await supabase.from('project_michael_settings').upsert(
    {
      project_id: projectId,
      prompt: trimmed === '' ? null : trimmed,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' }
  );
  return !error;
}

async function buildContext(
  project: {
    id: string;
    name: string;
    description: string | null;
    team_id: string | null;
    repo_url: string | null;
    deadline: string | null;
  },
  userId: string,
  additionalPrompt: string
): Promise<MichaelContext> {
  const supabase = await createClient();

  // 1. Team members (used as the universe for suggestedAssigneeId).
  //    The specialization is what lets Michael route work to whoever
  //    actually does that kind of work: the specialty each member declared.
  let teamMembers: { user_id: string; name: string; specialization: string | null }[] = [];
  if (project.team_id) {
    const { data: teamRows } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', project.team_id);
    const ids = (teamRows || []).map((r) => r.user_id);
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, specialization')
        .in('id', ids);
      teamMembers = (profiles || []).map((p) => {
        const row = p as {
          id: string;
          name: string;
          specialization?: string | null;
        };
        return {
          user_id: row.id,
          name: row.name,
          specialization: row.specialization?.trim() || null,
        };
      });
    }
  }

  // 2. The repository itself. Michael reads it straight from GitHub using
  //    the connected account's token, so he can ground tasks in real files.
  //    A failure here is never fatal — the snapshot carries the reason.
  const { token } = await getStoredGithubToken(supabase, userId);
  const repo = await buildRepoSnapshot(project.repo_url, token);

  // 3. Existing tasks so Michael doesn't duplicate them.
  const { data: boards } = await supabase
    .from('boards')
    .select('id')
    .eq('project_id', project.id);

  let existingTasks: { title: string; status: string }[] = [];
  const boardIds = (boards || []).map((b) => b.id);
  if (boardIds.length > 0) {
    const { data: cols } = await supabase
      .from('columns')
      .select('id')
      .in('board_id', boardIds);
    const colIds = (cols || []).map((c) => c.id);
    if (colIds.length > 0) {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('title, status')
        .in('column_id', colIds)
        .neq('status', 'done')
        .limit(60);
      existingTasks = tasks || [];
    }
  }

  return {
    projectName: project.name,
    projectDescription: project.description || '',
    repoUrl: project.repo_url,
    repo,
    teamMembers,
    existingTasks,
    deadline: project.deadline || null,
    additionalPrompt,
  };
}

// ---------------------------------------------------------------------------
// GET — load the team's brief so the panel can pre-fill it
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
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

    const project = await authorizeProject(supabase, projectId, user.id);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    const prompt = await readStoredPrompt(supabase, projectId);
    return NextResponse.json({
      prompt,
      hasRepo: !!project.repo_url,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Could not load Michael settings';
    console.error('Michael settings load error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT — save the team's brief
// ---------------------------------------------------------------------------
export async function PUT(
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

    const project = await authorizeProject(supabase, projectId, user.id);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const raw = typeof body?.prompt === 'string' ? body.prompt : '';

    const ok = await savePrompt(supabase, projectId, user.id, raw);
    if (!ok) {
      return NextResponse.json(
        { error: 'Could not save the instructions' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Could not save Michael settings';
    console.error('Michael settings save error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — generate the task proposals
// ---------------------------------------------------------------------------
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

    const project = await authorizeProject(supabase, projectId, user.id);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    // The prompt may be sent inline (so the user can tweak it without saving
    // first). When it is, we also persist it so the brief sticks with the
    // project for next time.
    const body = await request.json().catch(() => ({}));
    const inlinePrompt =
      typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : null;

    let additionalPrompt: string;
    if (inlinePrompt !== null) {
      additionalPrompt = inlinePrompt;
      await savePrompt(supabase, projectId, user.id, inlinePrompt);
    } else {
      additionalPrompt = await readStoredPrompt(supabase, projectId);
    }

    const ctx = await buildContext(project, user.id, additionalPrompt);
    const result = await michaelProposeTasks(ctx);

    // Stamp stable client-side ids so the UI can edit/delete proposals.
    const tasks = result.tasks.map((t, i) => ({
      ...t,
      clientId: `mt_${Date.now().toString(36)}_${i}`,
    }));

    // What Michael actually managed to read — the panel surfaces this so the
    // team can tell the difference between "no tasks to do" and "I could not
    // see the code".
    const repo = ctx.repo;
    return NextResponse.json({
      message: result.message,
      tasks,
      repo: repo
        ? {
            repoFullName: repo.repoFullName,
            defaultBranch: repo.defaultBranch,
            totalFiles: repo.totalFiles,
            filesRead: repo.files.length,
            languages: repo.languages,
            notes: repo.notes,
          }
        : null,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Michael failed unexpectedly';
    console.error('Michael generate error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
