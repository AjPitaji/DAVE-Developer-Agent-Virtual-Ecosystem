import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/dwight/[projectId]/reviews/[reviewId]
 *
 * Fetch a single review (RLS handles project scoping). The route also
 * returns the task title so the UI can show a friendly header without a
 * second round-trip.
 */
export async function GET(
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

    const fullSelect =
      'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, pr_number, pr_url, log, status, error_message, triggered_by, created_at, updated_at';
    const fallbackSelect =
      'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, status, error_message, triggered_by, created_at, updated_at';

    let review: { log?: unknown[] } | null = null;
    let error: { message: string } | null = null;
    const first = await supabase
      .from('task_reviews')
      .select(fullSelect)
      .eq('id', reviewId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (first.error && /column .*log .*does not exist/i.test(first.error.message)) {
      const fallback = await supabase
        .from('task_reviews')
        .select(fallbackSelect)
        .eq('id', reviewId)
        .eq('project_id', projectId)
        .maybeSingle();
      review = (fallback.data as { log?: unknown[] } | null)
        ? { ...(fallback.data as object), log: [] }
        : null;
      error = fallback.error;
    } else {
      review = first.data as { log?: unknown[] } | null;
      error = first.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    return NextResponse.json({ review });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load review';
    console.error('Dwight review fetch error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}