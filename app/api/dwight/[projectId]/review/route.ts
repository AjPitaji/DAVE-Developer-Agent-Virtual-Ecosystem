import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  dwightReview,
  fetchDefaultBranch,
  fetchLatestCommit,
  findPullRequestByDisplayId,
  pickVerdictColumn,
  buildVerdictMessage,
  runDwightPrReview,
  ReviewLogger,
  LogEntry,
  DwightContext,
  BoardColumn,
  GithubAuthError,
  bounceBackPrNotFound,
  PR_NOT_FOUND,
} from '@/lib/agents/dwight';
import {
  getStoredGithubToken,
  githubReauthResponse,
} from '@/lib/github/server';

/**
 * POST /api/dwight/[projectId]/review
 * Body: { taskId: string }
 *
 * Looks up the task and decides what to review:
 *   1. If the task has a linked PR (tasks.pr_number), review that PR's diff.
 *   2. Else if the task has a display_id (e.g. "DG-1"), search GitHub for a
 *      PR whose title contains it — common when the user pushes a branch
 *      and marks the task done without explicitly linking the PR. This
 *      spares Dwight from reviewing whatever the latest commit on main
 *      happens to be (which is usually unrelated).
 *   3. Else, fall back to the latest commit on the repo's default branch.
 *
 * Dwight's verdict is applied to the task itself:
 *   - approved | comment      → status = "done"   (keeps current column)
 *   - changes_requested       → status = "in_progress" + the in-progress column
 *   - failed                  → status stays "under_review" (user can intervene)
 *
 * Every step (GitHub lookup, commit fetch, LLM call, verdict application)
 * is written to `task_reviews.log` so the Dwight panel can render a live
 * terminal of what's happening. Failed steps record the error message.
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
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    // Where the user should land after a re-auth. Defaults to the project
    // page so Dwight → reconnect → resume is a one-click flow.
    const returnTo =
      typeof body?.returnTo === 'string' && body.returnTo.startsWith('/')
        ? body.returnTo
        : `/projects/${projectId}`;
    const additionalPrompt =
      typeof body?.additionalPrompt === 'string' ? body.additionalPrompt : null;

    // ---- load project (need repo_url + access) -----------------------------
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

    // ---- load task ---------------------------------------------------------
    // `display_id` + `pr_*` columns are loaded so we can detect a PR even
    // when one wasn't explicitly linked on the task row (see the docstring
    // above). The display_id is something like "DG-1" — unique per project.
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, title, description, status, column_id, display_id, pr_url, pr_number, pr_branch')
      .eq('id', taskId)
      .single();
    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Make sure the task actually belongs to this project (boards -> columns
    // -> tasks chain).
    const { data: column } = await supabase
      .from('columns')
      .select('id, board_id, boards!inner(project_id)')
      .eq('id', task.column_id)
      .maybeSingle();
    type ColumnWithBoard = {
      id: string;
      board_id: string;
      boards: { project_id: string } | null;
    };
    const boardProjectId = (column as ColumnWithBoard | null)?.boards?.project_id;
    if (!column || boardProjectId !== projectId) {
      return NextResponse.json(
        { error: 'Task does not belong to this project' },
        { status: 400 }
      );
    }

    // ---- load the project's columns (for the in-progress target) ---------
    const { data: columnsData } = await supabase
      .from('columns')
      .select('id, name, position')
      .eq('board_id', column.board_id)
      .order('position', { ascending: true });
    type ProjectColumn = { id: string; name: string; position: number };
    const projectColumns: BoardColumn[] = ((columnsData as ProjectColumn[] | null) ?? []).map(
      (c) => ({ id: c.id, name: c.name, position: c.position })
    );

    // ---- load GitHub token -------------------------------------------------
    const { token: githubToken, githubUsername: _ghUsername } = await getStoredGithubToken(supabase, user.id);
    void _ghUsername;
    if (!githubToken) {
      const r = githubReauthResponse(supabase, user.id, { kind: 'missing', returnTo });
      return NextResponse.json(r.body, { status: r.status });
    }
    // Alias so the rest of this file can keep its old `profile.github_token`
    // references without renaming every callsite.
    const profile = { github_token: githubToken };

    // ---- PR detection ----------------------------------------------------
    // Three cases, in priority order:
    //   1. The task row has `pr_number` set — review that PR.
    //   2. The task has a `display_id` but no PR link — search GitHub for
    //      a PR whose title contains the display_id (e.g. "DG-1"). If a
    //      match is found, persist it on the task row so we don't search
    //      again next time, then review the PR. If NO match is found we
    //      deliberately bail out (see below) rather than reviewing the
    //      default-branch HEAD.
    //   3. Neither — fall through to the default-branch commit path.
    type TaskRow = {
      id: string;
      title: string;
      description: string | null;
      status: string;
      column_id: string;
      display_id: string | null;
      pr_url: string | null;
      pr_number: number | null;
      pr_branch: string | null;
    };
    const taskRow = task as TaskRow;
    let linkedPrNumber: number | null = taskRow.pr_number ?? null;
    let linkedPrUrl: string | null = taskRow.pr_url ?? null;
    if (!linkedPrNumber && taskRow.display_id) {
      try {
        const found = await findPullRequestByDisplayId(
          project.repo_url,
          profile.github_token,
          taskRow.display_id,
          { returnTo }
        );
        if (found) {
          linkedPrNumber = found.number;
          linkedPrUrl = found.url;
          // Persist on the task so subsequent reviews (and the DwightPanel's
          // `pr_number` chip) see the link without a fresh search. We
          // don't fail the review if this update errors — Dwight can still
          // review the PR using the in-memory value.
          const { error: linkError } = await supabase
            .from('tasks')
            .update({ pr_number: found.number, pr_url: found.url })
            .eq('id', taskId);
          if (linkError) {
            console.warn('Dwight: could not persist discovered PR link:', linkError.message);
          }
        } else {
          // No PR matches this task's display id. Reviewing the
          // default-branch HEAD here would grade an unrelated commit, so
          // bounce the task back to In Progress and stop. Dwight never
          // starts.
          const bounce = await bounceBackPrNotFound({
            supabase,
            userId: user.id,
            projectId,
            task: {
              id: taskRow.id,
              title: taskRow.title,
              description: taskRow.description,
              column_id: taskRow.column_id,
              pr_url: taskRow.pr_url,
              pr_branch: taskRow.pr_branch,
              display_id: taskRow.display_id,
            },
            projectColumns,
            currentColumnId: taskRow.column_id,
            hasDisplayId: true,
          });
          return NextResponse.json(
            {
              error: bounce.error,
              code: PR_NOT_FOUND,
              summary: bounce.summary,
              task: bounce.updatedTask,
              prNumber: null,
            },
            { status: bounce.status }
          );
        }
      } catch (err) {
        if (err instanceof GithubAuthError) {
          // Bubble the structured reauth response out — the task hasn't
          // been marked under_review yet (that happens inside the PR
          // pipeline), so there's nothing to roll back.
          const r = githubReauthResponse(supabase, user.id, {
            kind: 'invalid',
            returnTo,
            detail: err.detail,
          });
          return NextResponse.json(r.body, { status: r.status });
        }
        // Search API errors shouldn't block the review — fall through to
        // the default-branch path. The original error message is logged
        // so the operator can see why the fallback ran.
        console.warn(
          'Dwight: PR search failed, falling back to default-branch review:',
          err instanceof Error ? err.message : err
        );
      }
    }

    if (linkedPrNumber) {
      // Delegate the entire PR review pipeline to the shared helper so
      // this route and `/review-pr` can't drift apart. The helper writes
      // its own pending row + activity log.
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
          id: taskRow.id,
          title: taskRow.title,
          description: taskRow.description,
          column_id: taskRow.column_id,
          pr_url: linkedPrUrl,
          pr_branch: taskRow.pr_branch,
        },
        projectColumns,
        prNumber: linkedPrNumber,
        githubToken: profile.github_token,
        returnTo,
        additionalPrompt,
      });
      if (!result.ok) {
        // Surface the reauth payload (if any) so the UI can render the
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
        prNumber: linkedPrNumber,
        prUrl: linkedPrUrl,
      });
    }

    // ---- create a pending review row up front so the UI can subscribe ----
    // We also pre-create the logger here so we can record "queued" /
    // "GitHub lookup started" / "verdict applied" events for the user.
    //
    // The `log` column is added in a follow-up migration; if it's still
    // missing on a project that was set up before the activity feed was
    // introduced, the insert would fail with "column log does not exist".
    // Try with the column first; if that errors, retry without it so the
    // review still completes (the terminal will just be empty).
    const pendingBaseRow = {
      project_id: projectId,
      task_id: taskId,
      verdict: 'comment',
      summary: 'Dwight is reviewing the latest commit on the default branch…',
      findings: [],
      body_markdown: '',
      branch: '',
      commit_sha: '',
      commit_short_sha: '',
      commit_message: '',
      files_reviewed: [],
      status: 'pending',
      triggered_by: user.id,
    };

    let pendingRow: { id: string } | null = null;
    let pendingError: { message: string } | null = null;
    let logColumnAvailable = true;

    const firstAttempt = await supabase
      .from('task_reviews')
      .insert({ ...pendingBaseRow, log: [] })
      .select('id')
      .single();
    if (firstAttempt.error || !firstAttempt.data) {
      // If the failure is the missing `log` column, retry without it. Any
      // other error is a real failure we should surface.
      const msg = firstAttempt.error?.message ?? '';
      if (/column .*log .*does not exist/i.test(msg) || /log.*column/i.test(msg)) {
        logColumnAvailable = false;
        const fallback = await supabase
          .from('task_reviews')
          .insert(pendingBaseRow)
          .select('id')
          .single();
        if (fallback.error || !fallback.data) {
          pendingError = fallback.error ?? { message: 'Failed to create review record' };
        } else {
          pendingRow = fallback.data;
        }
      } else {
        pendingError = firstAttempt.error ?? { message: 'Failed to create review record' };
      }
    } else {
      pendingRow = firstAttempt.data;
    }
    if (pendingError || !pendingRow) {
      return NextResponse.json(
        { error: pendingError?.message || 'Failed to create review record' },
        { status: 500 }
      );
    }
    const reviewId = pendingRow.id as string;

    // The logger streams every step into the `log` jsonb column so the UI
    // terminal can render live progress. If the column doesn't exist on
    // this project (older schema), we still create a logger so the rest
    // of the pipeline is happy — its flush is a no-op in that case.
    const logger = new ReviewLogger(async (entries: LogEntry[]) => {
      if (!logColumnAvailable) return;
      const { error } = await supabase
        .from('task_reviews')
        .update({ log: entries })
        .eq('id', reviewId);
      if (error) {
        // Don't throw — losing one log write shouldn't abort the review.
        console.warn('Dwight: log flush failed:', error.message);
      }
    });
    logger.info('Queued', `task=${task.title}`);

    // ---- flip the task to "under_review" so the board shows Dwight is on it
    logger.start('Mark task under review');
    if (task.status !== 'under_review') {
      const { error: markError } = await supabase
        .from('tasks')
        .update({ status: 'under_review' })
        .eq('id', taskId);
      if (markError) {
        logger.finish('Mark task under review', 'error', markError.message);
        console.warn('Dwight: could not mark task under_review:', markError.message);
      } else {
        logger.finish('Mark task under review', 'ok', `task was ${task.status}`);
      }
    } else {
      logger.finish('Mark task under review', 'ok', 'already under_review');
    }

    // ---- fetch default branch + latest commit ----------------------------
    let defaultBranch = '';
    let commit;
    logger.start('Resolving default branch', `GET /repos/...`);
    const branchStart = Date.now();
    try {
      const branchInfo = await fetchDefaultBranch(project.repo_url, profile.github_token, { returnTo });
      defaultBranch = branchInfo.defaultBranch;
      logger.finish(
        'Resolving default branch',
        'ok',
        `branch=${defaultBranch} (${branchInfo.fullName})`,
        Date.now() - branchStart
      );
    } catch (err) {
      if (err instanceof GithubAuthError) {
        logger.finish('Resolving default branch', 'error', err.detail, Date.now() - branchStart);
        await supabase
          .from('task_reviews')
          .update({
            status: 'failed',
            error_message: err.detail,
            summary: 'GitHub connection expired. Reconnect to continue.',
          })
          .eq('id', reviewId);
        await logger.finalFlush();
        return NextResponse.json(
          {
            error: 'GitHub connection expired. Reconnect to continue.',
            code: 'GITHUB_REAUTH_REQUIRED',
            authorizeUrl: err.authorizeUrl,
            reviewId,
          },
          { status: 401 }
        );
      }
      const message = err instanceof Error ? err.message : 'GitHub fetch failed';
      logger.finish('Resolving default branch', 'error', message, Date.now() - branchStart);
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: message,
          summary: `Couldn't reach GitHub: ${message}`,
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return NextResponse.json({ error: message, reviewId }, { status: 502 });
    }

    logger.start('Fetching latest commit', `GET /repos/.../commits?sha=${defaultBranch}&per_page=1`);
    const commitStart = Date.now();
    try {
      commit = await fetchLatestCommit(
        project.repo_url,
        profile.github_token,
        defaultBranch,
        { returnTo }
      );
    } catch (err) {
      if (err instanceof GithubAuthError) {
        logger.finish('Fetching latest commit', 'error', err.detail, Date.now() - commitStart);
        await supabase
          .from('task_reviews')
          .update({
            status: 'failed',
            error_message: err.detail,
            branch: defaultBranch,
            summary: 'GitHub connection expired. Reconnect to continue.',
          })
          .eq('id', reviewId);
        await logger.finalFlush();
        return NextResponse.json(
          {
            error: 'GitHub connection expired. Reconnect to continue.',
            code: 'GITHUB_REAUTH_REQUIRED',
            authorizeUrl: err.authorizeUrl,
            reviewId,
          },
          { status: 401 }
        );
      }
      const message = err instanceof Error ? err.message : 'GitHub commits fetch failed';
      logger.finish('Fetching latest commit', 'error', message, Date.now() - commitStart);
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: message,
          branch: defaultBranch,
          summary: `Couldn't fetch commits: ${message}`,
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return NextResponse.json({ error: message, reviewId }, { status: 502 });
    }
    if (!commit) {
      logger.finish('Fetching latest commit', 'error', 'no commits on default branch');
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: 'No commits found on the default branch.',
          branch: defaultBranch,
          summary: "Couldn't review — the default branch has no commits yet.",
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return NextResponse.json(
        { error: 'No commits to review', reviewId },
        { status: 404 }
      );
    }
    logger.finish(
      'Fetching latest commit',
      'ok',
      `${commit.shortSha} — ${commit.message} (${commit.files.length} file${commit.files.length === 1 ? '' : 's'})`,
      Date.now() - commitStart
    );

    // ---- run Dwight -------------------------------------------------------
    const ctx: DwightContext = {
      projectId,
      projectName: project.name,
      projectDescription: project.description || '',
      taskId,
      taskTitle: task.title,
       taskDescription: task.description,
       repoUrl: project.repo_url,
       githubToken: profile.github_token,
       additionalPrompt,
     };

    let review;
    try {
      review = await dwightReview(
        ctx,
        { kind: 'commit', defaultBranch, commit },
        (event) => {
          if (event.status === 'started') {
            logger.start(event.step, event.detail);
          } else if (event.status === 'ok' || event.status === 'error') {
            logger.finish(event.step, event.status, event.detail, event.duration_ms);
          } else {
            logger.info(event.step, event.detail);
          }
        }
      );
      logger.info(
        `Dwight returned ${review.verdict}`,
        `${review.findings.length} finding${review.findings.length === 1 ? '' : 's'}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dwight failed';
      logger.info('Dwight crashed', message);
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: message,
          branch: defaultBranch,
          commit_sha: commit.sha,
          commit_short_sha: commit.shortSha,
          commit_message: commit.message,
          files_reviewed: commit.files.map((f) => f.filename),
          summary: `Dwight crashed: ${message}`,
        })
        .eq('id', reviewId);
      await logger.finalFlush();
      return NextResponse.json({ error: message, reviewId }, { status: 500 });
    }

    // ---- persist final review -------------------------------------------
    logger.start('Persisting review');
    const persistStart = Date.now();
    const { data: finalRow, error: finalError } = await supabase
      .from('task_reviews')
      .update({
        status: 'completed',
        verdict: review.verdict,
        summary: review.summary,
        findings: review.findings,
        body_markdown: review.bodyMarkdown,
        branch: review.branch,
        commit_sha: review.commitSha,
        commit_short_sha: review.commitShortSha,
        commit_message: review.commitMessage,
        files_reviewed: review.filesReviewed,
      })
      .eq('id', reviewId)
      .select(
        'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, pr_number, pr_url, log, status, error_message, triggered_by, created_at, updated_at'
      )
      .single();
    if (finalError || !finalRow) {
      logger.finish('Persisting review', 'error', finalError?.message, Date.now() - persistStart);
      await logger.finalFlush();
      return NextResponse.json(
        { error: finalError?.message || 'Failed to persist review' },
        { status: 500 }
      );
    }
    logger.finish('Persisting review', 'ok', `row ${reviewId}`, Date.now() - persistStart);

    // ---- apply the verdict to the task ---------------------------------
    // approved / comment  → "done"  (stay in current column)
    // changes_requested   → "in_progress" + the in-progress column
    const outcome = pickVerdictColumn(review.verdict, task.column_id, projectColumns);
    const verdictMessage = buildVerdictMessage(review.verdict, review.summary);
    const targetColumnName = projectColumns.find((c) => c.id === outcome.columnId)?.name ?? '?';

    logger.start(
      'Applying verdict to task',
      `${review.verdict} → status=${outcome.status}, column=${targetColumnName}`
    );
    const applyStart = Date.now();
    const { data: updatedTask, error: applyError } = await supabase
      .from('tasks')
      .update({
        status: outcome.status,
        column_id: outcome.columnId,
        last_review_id: reviewId,
        last_review_verdict: review.verdict,
      })
      .eq('id', taskId)
      .select('id, status, column_id, last_review_id, last_review_verdict')
      .single();

    if (applyError || !updatedTask) {
      logger.finish(
        'Applying verdict to task',
        'error',
        applyError?.message ?? 'task update returned no row',
        Date.now() - applyStart
      );
      await logger.finalFlush();
      return NextResponse.json({
        review: finalRow,
        verdictApplied: false,
        verdictError: applyError?.message || 'Failed to apply verdict to task',
        message: verdictMessage,
      });
    }
    logger.finish(
      'Applying verdict to task',
      'ok',
      `task is now ${updatedTask.status} in column ${targetColumnName}`,
      Date.now() - applyStart
    );
    logger.info('Review complete', verdictMessage);
    await logger.finalFlush();

    return NextResponse.json({
      review: finalRow,
      verdictApplied: true,
      task: updatedTask,
      message: verdictMessage,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Dwight review failed unexpectedly';
    console.error('Dwight review error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}