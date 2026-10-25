import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { consultantRefine } from '@/lib/agents/consultant';
import { normalizeBrief } from '@/lib/hackathon/brief';
import type { ConsultantMessage } from '@/lib/types/idea';

/**
 * POST /api/hackathon/consult
 *
 * One turn of the consultant conversation. Takes the challenge brief, the
 * current project draft and the team's latest message, and returns a
 * conversational reply plus the updated draft.
 *
 * Request body:
 *   { brief: HackathonBrief, draft: { name, description, techStack }, message: string, history: ConsultantMessage[] }
 *
 * Response body:
 *   { reply: string, name: string, description: string, techStack: string[], error?: string }
 */

const MAX_MESSAGE_CHARS = 4000;

function normalizeHistory(value: unknown): ConsultantMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ConsultantMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const role = record.role === 'user' ? 'user' : 'assistant';
    const content =
      typeof record.content === 'string' ? record.content.slice(0, MAX_MESSAGE_CHARS) : '';
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out.slice(-10);
}

function normalizeDraft(value: unknown) {
  const record = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  const techStack = Array.isArray(record.techStack)
    ? record.techStack
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    name: typeof record.name === 'string' ? record.name.slice(0, 120) : '',
    description:
      typeof record.description === 'string' ? record.description.slice(0, 4000) : '',
    techStack,
  };
}

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
    const draft = normalizeDraft(body?.draft);
    const message =
      typeof body?.message === 'string'
        ? body.message.slice(0, MAX_MESSAGE_CHARS).trim()
        : '';
    const history = normalizeHistory(body?.history);

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const result = await consultantRefine(brief, draft, message, history);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'The consultant could not respond';
    console.error('Hackathon consult error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
