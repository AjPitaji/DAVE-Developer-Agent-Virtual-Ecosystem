import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Priority = 'low' | 'medium' | 'high' | 'urgent';
const VALID_PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

interface IncomingTask {
  title: string;
  description?: string;
  priority?: Priority;
  assignee_id?: string | null;
}

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

    // ---- verify membership -------------------------------------------------
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, owner_id, team_id')
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

    // ---- parse + validate body --------------------------------------------
    const body = await request.json();
    const incoming: unknown = body?.tasks;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: 'No tasks to create' }, { status: 400 });
    }
    if (incoming.length > 25) {
      return NextResponse.json(
        { error: 'Too many tasks in one batch (max 25)' },
        { status: 400 }
      );
    }

    const { data: board } = await supabase
      .from('boards')
      .select('id')
      .eq('project_id', projectId)
      .single();
    if (!board) {
      return NextResponse.json(
        { error: 'Project is missing a board' },
        { status: 400 }
      );
    }

    const { data: todoColumn } = await supabase
      .from('columns')
      .select('id')
      .eq('board_id', board.id)
      .order('position', { ascending: true })
      .limit(1)
      .single();
    if (!todoColumn) {
      return NextResponse.json(
        { error: 'Board has no columns' },
        { status: 400 }
      );
    }

    // ---- current position baseline so positions stay dense -----------------
    const { data: existingInTodo } = await supabase
      .from('tasks')
      .select('position')
      .eq('column_id', todoColumn.id)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = (existingInTodo?.[0]?.position ?? -1) + 1;

    // ---- build the rows to insert -----------------------------------------
    const rows = (incoming as IncomingTask[]).flatMap((raw, i) => {
      const title = (raw.title || '').trim();
      if (!title) return []; // skip blank rows silently
      const priority: Priority = (
        raw.priority && VALID_PRIORITIES.includes(raw.priority) ? raw.priority : 'medium'
      );
      const row = {
        column_id: todoColumn.id,
        title,
        description: raw.description?.trim() || null,
        assignee_id: raw.assignee_id || null,
        priority,
        position: nextPos + i,
        status: 'todo' as const,
        created_by: user.id,
      };
      return [row];
    });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'All task titles were empty' },
        { status: 400 }
      );
    }

    // ---- insert -----------------------------------------------------------
    const { data: created, error: insertError } = await supabase
      .from('tasks')
      .insert(rows)
      .select('id, title, description, priority, assignee_id, column_id, status, position');

    if (insertError) {
      console.error('Michael create-tasks insert error:', insertError);
      return NextResponse.json(
        { error: insertError.message || 'Failed to create tasks' },
        { status: 500 }
      );
    }

    return NextResponse.json({ tasks: created ?? [], count: created?.length ?? 0 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Create tasks failed';
    console.error('Michael create-tasks error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}