import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/dwight/[projectId]/reviews/[reviewId]/cancel
 *
 * Manually marks a stuck `pending` review as `failed`. Used when the
 * Dwight tab detects a review that's been hanging for too long (empty log
 * or pending > 2 min) and offers a "Cancel" button. The task itself is
 * untouched — it stays in `under_review` so the user can drag it back to
 * in_progress or re-run Dwight from the task card.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; reviewId: string }> }
) {
  try {
    const { projectId, reviewId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Membership check
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
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

    // Find the review (RLS will also scope this) — refuse to cancel a
    // review that's already finished so the user can't undo a verdict.
    // If the `log` column doesn't exist (older schema), fall back to a
    // select without it.
    let review: { id: string; status: string; log?: unknown[] } | null = null;
    let fetchError: { message: string } | null = null;
    const firstFetch = await supabase
      .from('task_reviews')
      .select('id, status, log')
      .eq('id', reviewId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (firstFetch.error && /column .*log .*does not exist/i.test(firstFetch.error.message)) {
      const fallback = await supabase
        .from('task_reviews')
        .select('id, status')
        .eq('id', reviewId)
        .eq('project_id', projectId)
        .maybeSingle();
      if (fallback.data) {
        const base = fallback.data as { id: string; status: string };
        review = { id: base.id, status: base.status, log: [] };
      } else {
        review = null;
      }
      fetchError = fallback.error;
    } else {
      review = firstFetch.data as { id: string; status: string; log?: unknown[] } | null;
      fetchError = firstFetch.error;
    }
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }
    if (review.status !== 'pending') {
      return NextResponse.json(
        { error: `Review is ${review.status}, nothing to cancel` },
        { status: 400 }
      );
    }

    // Append a cancellation entry to the log so the trace is honest about
    // how the review ended. If the `log` column is missing on this
    // schema, we skip the append — the cancel still works.
    const existingLog = Array.isArray(review.log) ? (review.log as unknown[]) : [];
    const newLog = [
      ...existingLog,
      {
        ts: new Date().toISOString(),
        step: 'Review cancelled',
        status: 'error',
        detail: 'Cancelled from the Dwight tab — the request was stuck.',
      },
    ];

    // Build the update payload — include the log entry only if the
    // column exists in the current schema. Try the full update first,
    // retry without `log` if Postgres complains.
    let updated: Record<string, unknown> | null = null;
    let updateError: { message: string } | null = null;
    const fullUpdate = await supabase
      .from('task_reviews')
      .update({
        status: 'failed',
        error_message: 'Cancelled from the Dwight tab — review was stuck.',
        log: newLog,
      })
      .eq('id', reviewId)
      .select(
        'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, log, status, error_message, triggered_by, created_at, updated_at'
      )
      .single();
    if (fullUpdate.error && /column .*log .*does not exist/i.test(fullUpdate.error.message)) {
      const fallback = await supabase
        .from('task_reviews')
        .update({
          status: 'failed',
          error_message: 'Cancelled from the Dwight tab — review was stuck.',
        })
        .eq('id', reviewId)
        .select(
          'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, status, error_message, triggered_by, created_at, updated_at'
        )
        .single();
      updated = (fallback.data as Record<string, unknown> | null)
        ? { ...(fallback.data as object), log: [] }
        : null;
      updateError = fallback.error;
    } else {
      updated = (fullUpdate.data as Record<string, unknown> | null) ?? null;
      updateError = fullUpdate.error;
    }
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message || 'Failed to cancel review' },
        { status: 500 }
      );
    }

    return NextResponse.json({ review: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to cancel review';
    console.error('Dwight cancel error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}