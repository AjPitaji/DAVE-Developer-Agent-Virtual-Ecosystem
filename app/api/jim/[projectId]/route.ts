import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jimInitializeRepo, jimEditDescription, jimChat, jimEnhanceAndInitialize, JimContext } from '@/lib/agents/jim';
import { buildRepoSnapshot } from '@/lib/github/repo';
import { getStoredGithubToken } from '@/lib/github/server';

/**
 * Maximum length of the free-form Jim instructions. Keeps a pasted prompt
 * from ballooning the system prompt.
 */
const MAX_JIM_INSTRUCTIONS_LENGTH = 10000;

/**
 * Load the project row used to build the Jim context.
 */
async function fetchProjectRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, team_id, deadline, repo_url')
    .eq('id', projectId)
    .maybeSingle();

  if (error) return null;
  return data;
}

async function getProjectContext(projectId: string, userId: string): Promise<JimContext | null> {
  const supabase = await createClient();

  const project = await fetchProjectRow(supabase, projectId);

  if (!project) return null;

  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();

  if (!membership) return null;

  // The real file list, read from GitHub.
  //
  // This used to query a `github_files` table that no migration ever
  // created, so it silently returned nothing and Jim always saw
  // "Existing files: None" — which meant he regenerated files that were
  // already in the repo. Paths only here: Jim needs the names, not the
  // contents.
  const { token } = await getStoredGithubToken(supabase, userId);
  const snapshot = await buildRepoSnapshot(project.repo_url, token, {
    includeContents: false,
  });

  return {
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description || '',
    teamId: project.team_id,
    deadline: project.deadline || null,
    existingFiles: snapshot.paths.slice(0, 50),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, message, name, description } = body;

    // Optional, free-form instructions the team lead typed into the Jim
    // panel. This is a run-scoped override: it applies to this request only
    // and is never stored. When it's absent or empty, Jim runs with its
    // normal system prompt.
    let extraPrompt = typeof body.extraPrompt === 'string' ? body.extraPrompt.trim() : '';

    // Keeps a pasted prompt from ballooning the system prompt.
    if (extraPrompt.length > MAX_JIM_INSTRUCTIONS_LENGTH) {
      extraPrompt = extraPrompt.slice(0, MAX_JIM_INSTRUCTIONS_LENGTH);
    }

    // -----------------------------------------------------------------------
    // enhance-and-init: enhance title/description AND scaffold files in one shot
    // -----------------------------------------------------------------------
    if (action === 'enhance-and-init') {
      if (!name || !name.trim()) {
        return NextResponse.json({ error: 'Project title is required' }, { status: 400 });
      }
      if (!description || !description.trim()) {
        return NextResponse.json({ error: 'Project description is required' }, { status: 400 });
      }

      // Verify membership before allowing writes
      const { data: project } = await supabase
        .from('projects')
        .select('id, owner_id')
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

      const ctx = await getProjectContext(projectId, user.id);
      if (!ctx) {
        return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
      }

      // The instructions are a run-scoped override layered on top of the
      // project's own context.
      const effectiveCtx: JimContext = {
        ...ctx,
        extraPrompt: extraPrompt || null,
      };

      const result = await jimEnhanceAndInitialize(effectiveCtx, name.trim(), description.trim());

      // Persist whatever Jim enhanced back to the DB so the UI reflects it.
      // The user can also pass `key` to override Jim's suggestion before
      // we write it to the project.
      const updates: Record<string, string> = {};
      if (result.updatedTitle) updates.name = result.updatedTitle;
      if (result.updatedDescription) updates.description = result.updatedDescription;

      // Pick the key: explicit override > Jim's suggestion > derive from
      // the polished title. Only write to the project if the project
      // doesn't already have a key, so re-running Jim on an existing
      // project never silently renumbers the tasks.
      const { data: existingProject } = await supabase
        .from('projects')
        .select('key')
        .eq('id', projectId)
        .single();
      const incomingKey =
        (typeof body.key === 'string' && body.key.trim()) ||
        result.suggestedKey ||
        '';
      const normalizedKey = incomingKey.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (!existingProject?.key && normalizedKey.length >= 2) {
        updates.key = normalizedKey;
        // Keep the in-memory result in sync so the panel shows what was
        // actually saved.
        result.suggestedKey = normalizedKey;
      } else if (existingProject?.key) {
        // Don't overwrite an existing key. Surface the current one back
        // so the UI can show "your key is DV" even if Jim suggested DV-2.
        result.suggestedKey = existingProject.key;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('projects')
          .update(updates)
          .eq('id', projectId);
        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }

      return NextResponse.json(result);
    }

    // -----------------------------------------------------------------------
    // update-details: save name + description directly to DB (no LLM needed)
    // -----------------------------------------------------------------------
    if (action === 'update-details') {
      if (!name && !description) {
        return NextResponse.json({ error: 'Provide at least name or description' }, { status: 400 });
      }

      // Verify membership before allowing writes
      const { data: project } = await supabase
        .from('projects')
        .select('id, owner_id')
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

      const updates: Record<string, string> = {};
      if (name) updates.name = name;
      if (description !== undefined) updates.description = description;

      const { error: updateError } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', projectId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({
        action: 'update',
        message: 'Project details updated',
        updatedName: name || undefined,
        updatedDescription: description ?? undefined,
      });
    }

    // -----------------------------------------------------------------------
    // All other actions require full project context
    // -----------------------------------------------------------------------
    const ctx = await getProjectContext(projectId, user.id);
    if (!ctx) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
    }

    // Same run-scoped override as enhance-and-init.
    const actionCtx: JimContext = {
      ...ctx,
      extraPrompt: extraPrompt || null,
    };

    let result;
    switch (action) {
      case 'initialize':
        result = await jimInitializeRepo(actionCtx);
        break;
      case 'edit-description':
        result = await jimEditDescription(actionCtx, message || '');
        break;
      case 'chat':
        result = await jimChat(actionCtx, message || '');
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // If the LLM updated the description, persist it to the DB so it's not lost
    if (result.action === 'update' && result.updatedDescription) {
      await supabase
        .from('projects')
        .update({ description: result.updatedDescription })
        .eq('id', projectId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Jim API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
