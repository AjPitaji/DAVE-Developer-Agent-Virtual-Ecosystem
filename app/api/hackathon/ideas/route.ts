import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { consultantSuggestIdeas } from '@/lib/agents/consultant';
import { normalizeBrief } from '@/lib/hackathon/brief';

/**
 * POST /api/hackathon/ideas
 *
 * Suggests buildable project ideas for a scraped DevPost challenge.
 *
 * Request body:
 *   { brief: HackathonBrief }
 *
 * Response body:
 *   { ideas: ProjectIdea[], error?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const brief = normalizeBrief(body?.brief);

    if (!brief.title && brief.sections.length === 0) {
      return NextResponse.json(
        { error: 'No challenge context. Scrape the hackathon first.' },
        { status: 400 }
      );
    }

    const ideas = await consultantSuggestIdeas(brief);

    return NextResponse.json({ ideas });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Could not generate ideas right now';
    console.error('Hackathon ideas error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
