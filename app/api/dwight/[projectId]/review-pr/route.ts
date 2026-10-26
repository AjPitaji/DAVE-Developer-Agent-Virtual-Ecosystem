import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  runDwightPrReview,
} from '@/lib/agents/dwight';
import {
  getStoredGithubToken,
  githubReauthResponse,
} from '@/lib/github/server';

/**
 * POST /api/dwight/[projectId]/review-pr
 * Body: { taskId: string, prNumber?: number }
 *
 * Reviews the GitHub PR linked to a task. If `prNumber` is omitted we
 * look it up on the task itself. The PR diff is fetched via
 * `GET /repos/{owner}/{repo}/pulls/{pr}/files`, passed to Dwight, and
 * the verdict is applied to the task exactly like a default-branch review
 * (approved/comment → done, changes_requested → in-progress).
 *
 * The actual PR pipeline lives in `runDwightPrReview` so this route and
 * `/api/dwight/[projectId]/review` (which falls back to PR-review mode
 * automatically when it discovers a PR via the task's display_id) can't
 * drift apart.
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

    const body = await request.json();
    const taskId = typeof body?.taskId === 'string' ? body.taskId : '';
    const explicitPr = typeof body?.prNumber === 'number' ? body.prNumber : null;
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
  const returnTo =
    typeof body?.returnTo === 'string' && body.returnTo.startsWith('/')
      ? body.returnTo
      : `/projects/${projectId}`;
  const additionalPrompt =
    typeof body?.additionalPrompt === 'string' ? body.additionalPrompt : null;

    // ---- load project + check access --------------------------------------
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, name, description, owner_id, repo_url, team_id')
      .eq('id', projectId)
      .single();
    if (projectError || !project) {
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
    if (!project.repo_url) {
      return NextResponse.json(
        { error: 'No GitHub repo linked to this project.' },
        { status: 400 }
      );
    }

    // ---- load task + verify it belongs here ------------------------------
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, title, description, status, column_id, pr_url, pr_number, pr_branch')
      .eq('id', taskId)
      .single();
    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    const { data: column } = await supabase
      .from('columns')
      .select('id, board_id, boards!inner(project_id)')
      .eq('id', task.column_id)
      .maybeSingle();
    type ColumnWithBoard = { id: string; board_id: string; boards: { project_id: string } | null };
    const boardProjectId = (column as ColumnWithBoard | null)?.boards?.project_id;
    if (!column || boardProjectId !== projectId) {
      return NextResponse.json(
        { error: 'Task does not belong to this project' },
        { status: 400 }
      );
    }

    // ---- determine which PR to review ------------------------------------
    const prNumber = explicitPr ?? task.pr_number;
    if (!prNumber) {
      // No PR on the task and the caller didn't pass one. Record a failed
      // review so the Dwight panel can surface it, then 400 out.
      const insertRes = await supabase
        .from('task_reviews')
        .insert({
          project_id: projectId,
          task_id: taskId,
          verdict: 'comment',
          summary: 'No PR found with this task id',
          findings: [],
          body_markdown: '',
          branch: '',
          commit_sha: '',
          commit_short_sha: '',
          commit_message: '',
          files_reviewed: [],
          pr_number: null,
          pr_url: null,
          status: 'failed',
          error_message: 'No PR found with this task id',
          triggered_by: user.id,
          log: [],
        })
        .select('id')
        .single();
      return NextResponse.json(
        { error: 'No PR found with this task id', reviewId: insertRes.data?.id },
        { status: 400 }
      );
    }

    // ---- load columns for the in-progress fallback -----------------------
    const { data: columnsData } = await supabase
      .from('columns')
      .select('id, name, position')
      .eq('board_id', column.board_id)
      .order('position', { ascending: true });
    type ProjectColumn = { id: string; name: string; position: number };
    const projectColumns = ((columnsData as ProjectColumn[] | null) ?? []).map(
      (c) => ({ id: c.id, name: c.name, position: c.position })
    );

    // ---- load GitHub token -------------------------------------------------
    const { token: githubToken } = await getStoredGithubToken(supabase, user.id);
    if (!githubToken) {
      const r = githubReauthResponse(supabase, user.id, { kind: 'missing', returnTo });
      return NextResponse.json(r.body, { status: r.status });
    }
    const profile = { github_token: githubToken };

    // ---- run the shared PR-review pipeline -------------------------------
    const result = await runDwightPrReview({
      supabase,
      userId: user.id,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        repo_url: project.repo_url,
      },
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        column_id: task.column_id,
        pr_url: task.pr_url,
        pr_branch: task.pr_branch,
      },
      projectColumns,
      prNumber,
      githubToken: profile.github_token,
      returnTo,
      additionalPrompt,
    });

    if (!result.ok) {
      // Bubble the reauth payload (if any) so the UI can render the
      // one-click reconnect button without an extra round trip.
      const body: Record<string, unknown> = { error: result.error };
      if (result.reviewId) body.reviewId = result.reviewId;
      if (result.code) body.code = result.code;
      if (result.authorizeUrl) body.authorizeUrl = result.authorizeUrl;
      return NextResponse.json(body, { status: result.status });
    }
    const { review, verdictApplied, updatedTask, message } = result;
    return NextResponse.json({
      review,
      verdictApplied,
      task: updatedTask,
      message,
      source: 'pr',
      prNumber,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Dwight PR review failed unexpectedly';
    console.error('Dwight PR review error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}