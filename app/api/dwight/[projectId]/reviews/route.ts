import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/dwight/[projectId]/reviews?limit=20
 *
 * Returns the most recent Dwight reviews for a project (RLS enforces
 * project membership visibility).
 */
export async function GET(
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

    // Membership check (mirrors the review route so we don't leak reviews
    // to non-members even though RLS would also block them).
    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const isOwner = project.owner_id === user.id;
    const isMember = member && ['owner', 'dev'].includes(member.role);
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1),
      100
    );

    // Try the full select first (including `log`). If the column is missing
    // because the project was set up before the activity log migration, fall
    // back to a select without it. Reviews still load — the terminal will
    // just be empty until the migration is run.
    const fullSelect =
      'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, pr_number, pr_url, log, status, error_message, triggered_by, created_at, updated_at';
    const fallbackSelect =
      'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, status, error_message, triggered_by, created_at, updated_at';

    type ReviewRow = {
      id: string;
      project_id: string;
      task_id: string;
      created_at: string;
      updated_at: string;
      log?: unknown[];
    } & Record<string, unknown>;
    let reviews: ReviewRow[] | null = null;
    let error: { message: string } | null = null;
    const first = await supabase
      .from('task_reviews')
      .select(fullSelect)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (first.error && /column .*log .*does not exist/i.test(first.error.message)) {
      const fallback = await supabase
        .from('task_reviews')
        .select(fallbackSelect)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit);
      reviews = (fallback.data ?? []).map(
        (r) => ({ ...(r as unknown as object), log: [] }) as unknown as ReviewRow
      );
      error = fallback.error;
    } else {
      reviews = (first.data ?? []) as ReviewRow[];
      error = first.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ---- Surface the missing-column case so the UI can show a fix-it hint.
    // `logColumnMissing` is only true when we used the fallback select (i.e.
    // the `log` column doesn't exist on this database). The user gets a
    // one-click re-run path after they run the migration.
    const logColumnMissing =
      first.error !== null &&
      /column .*log .*does not exist/i.test(first.error.message);

    // ---- Safety net: auto-fail any review that's been stuck in `pending`
    // for more than 10 minutes. This catches server crashes / killed
    // processes where the review row is left orphaned. The user's
    // next list refresh will then see the review as `failed` and the
    // panel will stop polling for it.
    const STALE_PENDING_MS = 10 * 60 * 1000;
    const now = Date.now();
    const staleIds = (reviews ?? [])
      .filter(
        (r) =>
          r.status === 'pending' &&
          now - new Date(r.created_at).getTime() > STALE_PENDING_MS
      )
      .map((r) => r.id);
    if (staleIds.length > 0) {
      await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: 'Dwight did not finish this review in time (stuck pending > 10 min). Re-run to retry.',
        })
        .in('id', staleIds);
      // Patch the in-memory list so this response already reflects the
      // auto-fail (no need for the client to re-fetch).
      for (const r of reviews ?? []) {
        if (staleIds.includes(r.id)) {
          r.status = 'failed';
          r.error_message =
            'Dwight did not finish this review in time (stuck pending > 10 min). Re-run to retry.';
        }
      }
    }

    return NextResponse.json({ reviews: reviews ?? [], logColumnMissing });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load reviews';
    console.error('Dwight reviews list error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}