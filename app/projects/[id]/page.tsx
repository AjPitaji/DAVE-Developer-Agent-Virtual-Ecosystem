'use client'

import { useCallback, useEffect, useState, ReactNode } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Plus, MoreVertical, Trash2, CheckCircle2, Users, Bot, ChevronRight, GripVertical, ExternalLink, CalendarClock, Play, Sparkles, AlertCircle, Lock, Bot as BotIcon, LayoutDashboard, Briefcase, Inbox, MoreHorizontal, ChevronDown, CircleDot, CheckCircle, Rocket, X, Pencil, UserCheck, ShieldAlert, ShieldCheck, MessageSquare, GitCommit, GitBranch, Terminal, Info, GitPullRequest, Radar } from 'lucide-react'
import GithubIcon from '@/components/GithubIcon'
import Link from 'next/link'
import { JimPanel } from '@/components/JimPanel'
import CommitHistorySection from '@/components/CommitHistorySection'
import { MichaelPanel } from '@/components/MichaelPanel'
import { PamPanel } from '@/components/PamPanel'
import { DwightPanel } from '@/components/DwightPanel'
import { GithubReauthModal } from '@/components/GithubReauthModal'
import {
  consumeRetry,
  GithubReauthPayload,
} from '@/lib/github/client'

interface Project {
  id: string
  name: string
  description: string | null
  max_open_tasks: number
  // Mirrors the public.project_status enum exactly so TS catches mismatches
  // (the page used to claim 'paused' | 'completed' which the enum never had).
  status: 'active' | 'draft' | 'archived' | 'on_hold'
  team_id: string
  owner_id: string
  repo_url: string | null
  // Short uppercase prefix that turns "DAVE" into tasks "DV-1", "DV-2".
  // Set by Jim during init; the user can override in the Jim panel.
  key: string | null
  deadline: string | null
  started_at: string | null
  teams: {
    name: string
  }
  profiles: {
    name: string
    github_username: string | null
  } | null
}

interface StartReadiness {
  has_deadline: boolean
  deadline_passed: boolean
  total_tasks: number
  unassigned_tasks: number
  members_total: number
  members_with_task: number
  is_owner: boolean
  can_start: boolean
}

interface Board {
  id: string
  name: string
  type: 'kanban' | 'scrum'
}

interface Column {
  id: string
  board_id: string
  name: string
  position: number
}

interface Task {
  id: string
  title: string
  description: string | null
  // Mirrors public.task_status; the runtime state owned by Dwight is
  // 'under_review' — see migrations/20261015000000_under_review_state.sql.
  status: 'todo' | 'in_progress' | 'under_review' | 'done' | 'blocked' | string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee_id: string | null
  created_by: string
  column_id: string
  position: number
  created_at?: string
  // Denormalised pointers to the latest Dwight review, set by the Dwight
  // API when a review completes. null when the task has never been reviewed.
  last_review_id?: string | null
  last_review_verdict?: 'approved' | 'changes_requested' | 'comment' | null
  // User-facing task id like "DV-1". Set by a BEFORE INSERT trigger
  // when the project has a key; null when the project hasn't been
  // initialized with Jim yet.
  display_id?: string | null
  // Linked GitHub PR — when set, Dwight reviews the PR diff instead of
  // the default-branch HEAD when the task is marked done.
  pr_url?: string | null
  pr_number?: number | null
  pr_branch?: string | null
  profiles?: {
    name: string
    avatar_url: string | null
  }
}

interface LatestReview {
  id: string
  project_id: string
  task_id: string
  verdict: 'approved' | 'changes_requested' | 'comment'
  summary: string
  findings: Array<{
    path: string
    summary: string
    severity: 'info' | 'minor' | 'major' | 'critical'
    note?: string
  }>
  body_markdown: string
  branch: string
  commit_sha: string
  commit_short_sha: string
  commit_message: string
  files_reviewed: string[]
  pr_number: number | null;
  pr_url: string | null;
  log: Array<{
    ts: string
    step: string
    status: 'started' | 'ok' | 'error' | 'info'
    detail?: string
    duration_ms?: number
  }>
  status: 'pending' | 'completed' | 'failed'
  error_message: string | null
  triggered_by: string | null
  created_at: string
  updated_at: string
}

const priorityColors = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  urgent: 'bg-gradient-to-r from-red-500 to-rose-500 text-white border-transparent shadow-md shadow-red-500/30',
}

// Per-priority accent ring used by the task card (drives the hover halo).
const priorityAccent = {
  low: 'hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-gray-500/20',
  medium: 'hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-blue-500/30',
  high: 'hover:border-amber-300 dark:hover:border-amber-500 hover:shadow-amber-500/30',
  urgent: 'hover:border-rose-400 dark:hover:border-rose-400 hover:shadow-rose-500/40',
}

// Per-column accent colour for the column header gradient strip.
const columnAccent: Record<string, { bar: string; text: string; ring: string; dot: string }> = {
  'to do':          { bar: 'from-slate-400 via-slate-500 to-slate-400',  text: 'text-slate-700 dark:text-slate-300',  ring: 'shadow-slate-500/20',  dot: 'bg-slate-400' },
  'todo':           { bar: 'from-slate-400 via-slate-500 to-slate-400',  text: 'text-slate-700 dark:text-slate-300',  ring: 'shadow-slate-500/20',  dot: 'bg-slate-400' },
  'backlog':        { bar: 'from-slate-400 via-slate-500 to-slate-400',  text: 'text-slate-700 dark:text-slate-300',  ring: 'shadow-slate-500/20',  dot: 'bg-slate-400' },
  'in progress':    { bar: 'from-blue-400 via-cyan-400 to-blue-400',      text: 'text-blue-700 dark:text-blue-300',    ring: 'shadow-blue-500/30',   dot: 'bg-blue-500 animate-pulse' },
  'doing':          { bar: 'from-blue-400 via-cyan-400 to-blue-400',      text: 'text-blue-700 dark:text-blue-300',    ring: 'shadow-blue-500/30',   dot: 'bg-blue-500 animate-pulse' },
  'review':         { bar: 'from-amber-400 via-orange-400 to-amber-400',  text: 'text-amber-700 dark:text-amber-300',  ring: 'shadow-amber-500/30',  dot: 'bg-amber-500 animate-pulse' },
  'testing':        { bar: 'from-amber-400 via-orange-400 to-amber-400',  text: 'text-amber-700 dark:text-amber-300',  ring: 'shadow-amber-500/30',  dot: 'bg-amber-500 animate-pulse' },
  'blocked':        { bar: 'from-red-400 via-rose-400 to-red-400',        text: 'text-red-700 dark:text-red-300',      ring: 'shadow-red-500/30',    dot: 'bg-red-500 animate-pulse' },
  'done':           { bar: 'from-emerald-400 via-teal-400 to-emerald-400',text: 'text-emerald-700 dark:text-emerald-300', ring: 'shadow-emerald-500/30', dot: 'bg-emerald-500' },
  'closed':         { bar: 'from-emerald-400 via-teal-400 to-emerald-400',text: 'text-emerald-700 dark:text-emerald-300', ring: 'shadow-emerald-500/30', dot: 'bg-emerald-500' },
  'complete':       { bar: 'from-emerald-400 via-teal-400 to-emerald-400',text: 'text-emerald-700 dark:text-emerald-300', ring: 'shadow-emerald-500/30', dot: 'bg-emerald-500' },
}

const defaultColumnAccent = { bar: 'from-purple-400 via-pink-400 to-purple-400', text: 'text-purple-700 dark:text-purple-300', ring: 'shadow-purple-500/20', dot: 'bg-purple-500' }

function getColumnAccent(name: string) {
  const key = name.toLowerCase().trim()
  for (const k of Object.keys(columnAccent)) {
    if (key === k || key.includes(k)) return columnAccent[k]
  }
  return defaultColumnAccent
}

// Map a column name to a hero icon used in the column header chip.
function getColumnIcon(name: string) {
  const k = name.toLowerCase()
  if (k.includes('done') || k.includes('closed') || k.includes('complete') || k.includes('finish')) return CheckCircle
  if (k.includes('progress') || k.includes('doing') || k.includes('review') || k.includes('testing')) return Rocket
  if (k.includes('block')) return Lock
  if (k.includes('backlog')) return CircleDot
  return Inbox
}

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const supabase = createClient()

  const [project, setProject] = useState<Project | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Drag and Drop State
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showProjectActions, setShowProjectActions] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  // New Task/Issue Modal State
  const [showNewTaskModal, setShowNewTaskModal] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [selectedAssignee, setSelectedAssignee] = useState<string>('')
  const [projectMembers, setProjectMembers] = useState<
    {
      user_id: string
      profiles: {
        name: string
        specialization?: string | null
      }
    }[]
  >([])
  const [submitting, setSubmitting] = useState(false)

  // Task Detail / Edit Modal State. `editingTask` is the source of truth —
  // null when the modal is closed, otherwise the task being viewed/edited.
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [editColumn, setEditColumn] = useState('')
  const [editAssignee, setEditAssignee] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  // PR-link state for the task detail modal. The user pastes a GitHub
  // PR URL; we parse out the number + branch and PATCH the task.
  const [prUrlDraft, setPrUrlDraft] = useState('')
  const [linkingPr, setLinkingPr] = useState(false)
  const [prLinkError, setPrLinkError] = useState('')

  // Create GitHub Repo Modal State
  const [showCreateRepoModal, setShowCreateRepoModal] = useState(false)
  const [repoName, setRepoName] = useState('')
  const [repoDescription, setRepoDescription] = useState('')
  const [repoPrivate, setRepoPrivate] = useState(true)
  const [creatingRepo, setCreatingRepo] = useState(false)
  const [repoError, setRepoError] = useState<ReactNode>('')

  // GitHub re-auth modal state. Set when any GitHub-backed action (create
  // repo, link PR, Dwight review, Jim push, …) returns
  // GITHUB_REAUTH_REQUIRED. The primary CTA kicks off the OAuth round
  // trip; on return the original action is queued in sessionStorage and
  // replayed from `consumeRetry()` on the next mount.
  const [githubReauth, setGithubReauth] = useState<GithubReauthPayload | null>(null)
  const [githubReauthAction, setGithubReauthAction] = useState<string>('')

  // Jim Panel State
  const [activeTab, setActiveTab] = useState<'board' | 'jim' | 'michael' | 'dwight' | 'pam' | 'commits'>('board')

  // Dwight hook: when a task is moved into "under_review" (the transient
  // state Dwight owns between "user marked done" and "Dwight accepted/
  // rejected"), we set this so the DwightPanel can auto-fire a review.
  // If the task has a linked PR, the panel reviews the PR diff immediately.
  // If not, the panel prompts the user to enter a PR number first.
  type ReviewTarget = { taskId: string; prNumber: number | null };
  const [freshlyDoneTask, setFreshlyDoneTask] = useState<ReviewTarget | null>(null);
  const clearFreshlyDoneTask = useCallback(() => setFreshlyDoneTask(null), []);

  // Tracks task ids where the PR search came back empty so we can show
  // a "PR not found" badge on the card. Cleared on the next board reload
  // (loadProjectData) so stale badges don't linger after the user acts.
  const [prNotFoundTaskIds, setPrNotFoundTaskIds] = useState<Set<string>>(new Set());
  const handlePrNotFound = useCallback((taskId: string) => {
    setPrNotFoundTaskIds((prev) => new Set(prev).add(taskId));
  }, []);

  // The three "user marks it done" call-sites route through this single
  // helper. The task's local state is already optimistically set to
  // 'under_review' by the caller; this just queues Dwight with the right
  // target (PR if linked, null if not — the panel will prompt for one).
  const fireDwightReview = useCallback(
    (taskId: string) => {
      if (!taskId) return;
      const task = tasks.find((t) => t.id === taskId);
      const target: ReviewTarget = {
        taskId,
        prNumber: task?.pr_number ?? null,
      };
      // Defer to next tick so the optimistic state update above paints first.
      setTimeout(() => setFreshlyDoneTask(target), 0);
    },
    [tasks]
  );

  // Planning / start flow state
  const [readiness, setReadiness] = useState<StartReadiness | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineDraft, setDeadlineDraft] = useState('')
  const [savingDeadline, setSavingDeadline] = useState(false)

  useEffect(() => {
    loadProjectData()
  }, [projectId])

  // If we just landed here from a GitHub re-auth round trip, surface a
  // friendly "you're back" toast. consumeRetry() clears the
  // sessionStorage entry on read so a manual refresh won't fire twice.
  // Side-effecting actions (Dwight auto-review on a freshly-done task,
  // repo creation, Jim push) are intentionally *not* auto-replayed —
  // they all require a fresh user click so we don't repeat work the
  // user didn't explicitly authorize.
  useEffect(() => {
    // Drain the queued retry marker so a manual refresh of the same
    // page doesn't fire twice. Side-effecting actions (Dwight auto-review,
    // repo creation, Jim push) require a fresh user click — we don't
    // auto-replay because the user might have changed their mind.
    const pending = consumeRetry()
    void pending
  }, [])

  // Reload the start-readiness snapshot whenever tasks change so the banner
  // reflects the current unassigned / member state without a full refresh.
  // We derive `showReadinessBanner` in render instead of clearing state in
  // this effect — that keeps setState out of the effect body (avoids a
  // cascading-render warning) and means the readiness just isn't displayed
  // once the project leaves draft.
  useEffect(() => {
    if (project?.status === 'draft' && project?.id) {
      loadReadiness()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.status, project?.id, tasks.length, projectMembers.length])

  async function loadReadiness() {
    try {
      const { data: projectData } = await supabase
        .from('projects')
        .select('deadline, owner_id')
        .eq('id', projectId)
        .single()

      const deadline = (projectData as { deadline: string | null } | null)?.deadline
      const ownerId = (projectData as { owner_id: string | null } | null)?.owner_id
      const hasDeadline = deadline !== null
      const deadlinePassed = hasDeadline && new Date(deadline!) < new Date()

      // Tasks counts via column -> board join
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('assignee_id')
        .in(
          'column_id',
          supabase
            .from('columns')
            .select('id')
            .in(
              'board_id',
              supabase
                .from('boards')
                .select('id')
                .eq('project_id', projectId)
            )
        )

      const tasks = (tasksData as { assignee_id: string | null }[] | null) || []
      const totalTasks = tasks.length
      const unassignedTasks = tasks.filter((t) => !t.assignee_id).length

      // Members counts
      const { data: membersData } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId)
      const members = (membersData as { user_id: string }[] | null) || []
      const membersTotal = members.length
      const membersWithTask = new Set(
        tasks.map((t) => t.assignee_id).filter(Boolean)
      ).size

      const isOwner = ownerId === currentUserId

      setReadiness({
        has_deadline: hasDeadline,
        deadline_passed: deadlinePassed,
        total_tasks: totalTasks,
        unassigned_tasks: unassignedTasks,
        members_total: membersTotal,
        members_with_task: membersWithTask,
        is_owner: isOwner,
        can_start: isOwner && hasDeadline && totalTasks > 0 && unassignedTasks === 0,
      })
    } catch (err) {
      console.warn('project_start_readiness failed:', err)
    }
  }

  async function handleStartProject() {
    if (!project) return
    setStarting(true)
    setStartError('')
    try {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', project.id)
      if (error) throw error
      setProject((prev) =>
        prev ? { ...prev, status: 'active', started_at: new Date().toISOString() } : prev
      )
      setReadiness(null)
    } catch (err: any) {
      setStartError(err.message || 'Failed to start project')
    } finally {
      setStarting(false)
    }
  }

  async function handleFinishProject() {
    if (!project || !isProjectOwner) return
    if (!confirm('Mark this project as finished? It will be archived.')) return
    setFinishing(true)
    try {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'archived' })
        .eq('id', project.id)
      if (error) throw error
      setProject((prev) => (prev ? { ...prev, status: 'archived' } : prev))
    } catch (err: any) {
      alert(err.message || 'Failed to finish project')
    } finally {
      setFinishing(false)
    }
  }

  async function handleDeleteProject() {
    if (!project || !isProjectOwner) return
    if (!confirm('Delete this project and all its tasks? This cannot be undone.')) return
    setDeleting(true)
    try {
      const { data: boardData } = await supabase
        .from('boards')
        .select('id')
        .eq('project_id', project.id)
        .single()
      if (boardData) {
        const { data: cols } = await supabase
          .from('columns')
          .select('id')
          .eq('board_id', boardData.id)
        if (cols && cols.length > 0) {
          const colIds = cols.map((c: { id: string }) => c.id)
          await supabase.from('tasks').delete().in('column_id', colIds)
          await supabase.from('columns').delete().eq('board_id', boardData.id)
        }
        await supabase.from('boards').delete().eq('id', boardData.id)
      }
      await supabase.from('projects').delete().eq('id', project.id)
      router.push('/dashboard')
    } catch (err: any) {
      alert(err.message || 'Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }
  function beginEditDeadline() {
    if (!project) return
    // Pre-fill the date input from either the existing deadline or today.
    const seed = project.deadline
      ? new Date(project.deadline)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // default: 1 week out
    setDeadlineDraft(seed.toISOString().slice(0, 10))
    setEditingDeadline(true)
  }

  async function saveDeadline() {
    if (!project) return
    if (!deadlineDraft) {
      setStartError('Please pick a deadline date.')
      return
    }
    setSavingDeadline(true)
    setStartError('')
    try {
      const iso = new Date(`${deadlineDraft}T23:59:59`).toISOString()
      const { error } = await supabase
        .from('projects')
        .update({ deadline: iso })
        .eq('id', project.id)
      if (error) throw error
      setProject((prev) => (prev ? { ...prev, deadline: iso } : prev))
      setEditingDeadline(false)
      loadReadiness()
    } catch (err: any) {
      setStartError(err.message || 'Failed to save deadline')
    } finally {
      setSavingDeadline(false)
    }
  }

  const handleDescriptionUpdate = async (newDescription: string) => {
    try {
      const { error } = await supabase
        .from('projects')
        .update({ description: newDescription })
        .eq('id', projectId)

      if (error) throw error
      setProject(prev => prev ? { ...prev, description: newDescription } : prev)
    } catch (err) {
      console.error('Failed to update description:', err)
    }
  }

  const handleTitleUpdate = async (newName: string) => {
    try {
      const { error } = await supabase
        .from('projects')
        .update({ name: newName })
        .eq('id', projectId)

      if (error) throw error
      setProject(prev => prev ? { ...prev, name: newName } : prev)
    } catch (err) {
      console.error('Failed to update project name:', err)
    }
  }

  // Called by the Jim panel after it sets a project key on the server.
  // Mirrors the title/description callbacks: it patches local project
  // state so the rest of the page (board, Dwight tab) sees the new
  // key without a full reload.
  const handleKeyUpdate = (newKey: string) => {
    setProject((prev) => (prev ? { ...prev, key: newKey } : prev));
  };

  async function loadProjectData() {
    // Clear any "PR not found" badges from the previous cycle — the board
    // is about to show fresh data so the transient flags are no longer valid.
    setPrNotFoundTaskIds(new Set());
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setCurrentUserId(user.id)

      // 1. Load Project
      const projectSelect = `
          id,
          name,
          description,
          max_open_tasks,
          status,
          team_id,
          owner_id,
          repo_url,
          key,
          deadline,
          started_at,
          teams (
            name
          )
        `

      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select(projectSelect)
        .eq('id', projectId)
        .single()

      if (projectError) throw projectError

      // Fetch owner profile separately to avoid PostgREST relationship ambiguity
      let ownerProfile: { name: string; github_username: string | null } | null = null
      if (projectData?.owner_id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name, github_username')
          .eq('id', projectData.owner_id)
          .single()
        ownerProfile = profileData as { name: string; github_username: string | null } | null
      }

      const enrichedProject = {
        ...(projectData as unknown as Omit<Project, 'profiles'>),
        profiles: ownerProfile,
      }
      setProject(enrichedProject as unknown as Project)

      // 1b. Load Team Members (for task assignment dropdown)
      // Use team_members so all team devs are assignable, not just those already in project_members
      const projectTeamId = projectData?.team_id
      if (projectTeamId) {
        const { data: membersData, error: membersError } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', projectTeamId)

        if (!membersError && membersData) {
          const userIds = membersData.map((m: { user_id: string }) => m.user_id)
          let profilesMap: Record<
            string,
            { name: string; specialization: string | null }
          > = {}
          if (userIds.length > 0) {
            const { data: profilesData } = await supabase
              .from('profiles')
              .select('id, name, specialization')
              .in('id', userIds)
            profilesMap = Object.fromEntries(
              (profilesData || []).map(
                (p: {
                  id: string
                  name: string
                  specialization?: string | null
                }) => [
                  p.id,
                  {
                    name: p.name,
                    specialization: p.specialization ?? null,
                  },
                ]
              )
            )
          }
          setProjectMembers(
            membersData.map((m: { user_id: string }) => ({
              user_id: m.user_id,
              profiles: profilesMap[m.user_id] || {
                name: 'Unknown',
                specialization: null,
              },
            }))
          )
        }
      }

      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('id, name, type')
        .eq('project_id', projectId)
        .single()

      if (boardError) {
        // Only "no rows returned" justifies creating a board. Any other error
        // (RLS violation, network failure) must surface as-is: blindly trying
        // to INSERT used to mask a permissions problem as a misleading
        // "new row violates row-level security policy for table boards".
        const isMissingRow =
          boardError.code === 'PGRST116' ||
          boardError.code === 'PGRST301' ||
          /returned no rows/i.test(boardError.message || '')

        if (!isMissingRow) {
          throw boardError
        }

        const { data: newBoard, error: createError } = await supabase
          .from('boards')
          .insert({
            project_id: projectId,
            name: 'Sprint Board',
            type: 'kanban',
          })
          .select()
          .single()

        if (createError) throw createError
        setBoard(newBoard)
      } else {
        setBoard(boardData)
      }

      // 3. Load Columns (should exist via trigger)
      const boardIdToUse = boardData?.id || board?.id
      if (boardIdToUse) {
        const { data: columnsData, error: columnsError } = await supabase
          .from('columns')
          .select('*')
          .eq('board_id', boardIdToUse)
          .order('position')

        if (columnsError) throw columnsError
        setColumns(columnsData || [])

        // 4. Load Tasks (tasks belong to columns, not directly to projects)
        const columnIds = (columnsData as { id: string }[] | null)?.map((c: { id: string }) => c.id) || []

        if (columnIds.length > 0) {
          const { data: tasksData, error: tasksError } = await supabase
            .from('tasks')
            .select(`
              id,
              title,
              description,
              status,
              priority,
              assignee_id,
              created_by,
              column_id,
              position,
              last_review_id,
              last_review_verdict,
              display_id,
              pr_url,
              pr_number,
              pr_branch
            `)
            .in('column_id', columnIds)
            .order('position')

          if (tasksError) throw tasksError

          // Manually fetch profiles for assigned users
          const userIds =
            (tasksData as { assignee_id: string | null }[] | null)
              ?.map((t: { assignee_id: string | null }) => t.assignee_id)
              .filter(Boolean) || []
          const uniqueUserIds = [...new Set(userIds)]

          let profilesMap: Record<string, { name: string; avatar_url: string | null }> = {}
          if (uniqueUserIds.length > 0) {
            const { data: profilesData } = await supabase
              .from('profiles')
              .select('id, name, avatar_url')
              .in('id', uniqueUserIds)

            profilesMap = Object.fromEntries(
              ((profilesData || []) as { id: string; name: string; avatar_url: string | null }[]).map(
                (p: { id: string; name: string; avatar_url: string | null }) => [
                  p.id,
                  { name: p.name, avatar_url: p.avatar_url },
                ]
              )
            )
          }

          // Merge profiles into tasks
          const enrichedTasks = ((tasksData || []) as (Task & { assignee_id: string | null })[]).map(
            (task: Task & { assignee_id: string | null }) => ({
              ...task,
              profiles: task.assignee_id ? profilesMap[task.assignee_id] : undefined,
            })
          )

          setTasks(enrichedTasks as unknown as Task[])
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load project data')
    } finally {
      setLoading(false)
    }
  }

  const openNewTaskModal = () => {
    setNewTaskTitle('')
    setNewTaskDescription('')
    setNewTaskPriority('medium')
    setSelectedAssignee('')
    setShowNewTaskModal(true)
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      if (!currentUserId) throw new Error('Not authenticated')

      // Find the first column (default: To Do)
      const toDoColumn = columns.find((c) => c.position === 0) || columns[0]
      if (!toDoColumn) throw new Error('No columns found')

      // Calculate next position in the To Do column
      const tasksInColumn = tasks.filter((t) => t.column_id === toDoColumn.id)
      const nextPosition = tasksInColumn.length

      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          column_id: toDoColumn.id,
          title: newTaskTitle,
          description: newTaskDescription || null,
          status: 'todo',
          priority: newTaskPriority,
          assignee_id: selectedAssignee || null,
          created_by: currentUserId,
          position: nextPosition,
        })
        .select()
        .single()

      if (taskError) throw taskError

      // Fetch the assignee's profile if assigned
      let profile = null
      if (selectedAssignee) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name, avatar_url')
          .eq('id', selectedAssignee)
          .single()
        profile = profileData
      }

      const enrichedTask = {
        ...newTask,
        profiles: profile || undefined,
      }

      setTasks((prev) => [...prev, enrichedTask as unknown as Task])
      setShowNewTaskModal(false)
    } catch (err: any) {
      alert(err.message || 'Failed to create issue')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMoveTask = async (taskId: string, targetColumnId: string) => {
    try {
      const targetColumn = columns.find((c) => c.id === targetColumnId)
      if (!targetColumn) return

      // Determine appropriate status based on target column name.
      // Dropping a task into the Done column puts it into the "under_review"
      // state owned by Dwight — Dwight is the only thing that can flip it
      // to "done" after a successful review.
      let newStatus: 'todo' | 'in_progress' | 'under_review' | 'done' | 'blocked' = 'todo'
      const colName = targetColumn.name.toLowerCase()
      if (colName.includes('done') || colName.includes('closed') || colName.includes('complete')) {
        newStatus = 'under_review'
      } else if (colName.includes('progress') || colName.includes('review') || colName.includes('testing')) {
        newStatus = 'in_progress'
      } else if (colName.includes('block')) {
        newStatus = 'blocked'
      }

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, column_id: targetColumnId, status: newStatus } : t
        )
      )

      const { error } = await supabase
        .from('tasks')
        .update({
          column_id: targetColumnId,
          status: newStatus,
        })
        .eq('id', taskId)

      if (error) {
        // Revert on error
        loadProjectData()
        throw error
      }

      // Dwight triggers automatically whenever a task enters "under_review".
      if (newStatus === 'under_review') {
        fireDwightReview(taskId)
      }
    } catch (err: any) {
      alert(err.message || 'Failed to move task')
    }
  }

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    // Block drag-to-move for non-owners while the project is in draft.
    if (!canEditTasks) {
      e.preventDefault()
      return
    }
    setDraggedTask(task)
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    if (!canEditTasks) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverColumn !== columnId) {
      setDragOverColumn(columnId)
    }
  }

  const handleDragLeave = (columnId: string) => {
    if (dragOverColumn === columnId) {
      setDragOverColumn(null)
    }
  }

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    setDragOverColumn(null)
    if (!canEditTasks) {
      setDraggedTask(null)
      return
    }
    if (!draggedTask || draggedTask.column_id === targetColumnId) {
      setDraggedTask(null)
      return
    }

    await handleMoveTask(draggedTask.id, targetColumnId)
    setDraggedTask(null)
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId)

      if (error) throw error

      setTasks((prev) => prev.filter((t) => t.id !== taskId))
    } catch (err: any) {
      alert(err.message || 'Failed to delete task')
    }
  }

  // Open the task detail / edit modal and pre-fill the form fields from
  // the task. Read-only viewers still get the modal so they can inspect
  // the task; the input controls are disabled further down via canEditTasks.
  const openTaskDetail = (task: Task) => {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditDescription(task.description || '')
    setEditPriority(task.priority)
    setEditColumn(task.column_id)
    setEditAssignee(task.assignee_id || '')
    setEditError('')
    setPrUrlDraft(task.pr_url || '')
    setPrLinkError('')
    void loadLatestReview(task.id)
  }

  const closeTaskDetail = () => {
    if (savingEdit) return
    setEditingTask(null)
    setEditError('')
    setLatestReview(null)
    setPrUrlDraft('')
    setPrLinkError('')
  }

  // ---- Latest Dwight review for the currently-open task ---------------------
  // Stored denormalised on the task as `last_review_id` so we can do a
  // targeted fetch instead of paginating the whole project's reviews.
  const [latestReview, setLatestReview] = useState<LatestReview | null>(null)
  const [latestReviewLoading, setLatestReviewLoading] = useState(false)

  const loadLatestReview = useCallback(
    async (taskId: string) => {
      setLatestReviewLoading(true)
      try {
        // First, find the most recent review for this task. We don't use the
        // denormalised `last_review_id` because the modal might be open for
        // a task whose review was just created and the in-memory Task row
        // hasn't caught up yet.
        const { data: row, error: rowError } = await supabase
          .from('task_reviews')
          .select('id')
          .eq('task_id', taskId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (rowError) {
          setLatestReview(null)
          return
        }
        if (!row) {
          setLatestReview(null)
          return
        }
        const { data: review, error } = await supabase
          .from('task_reviews')
          .select(
            'id, project_id, task_id, verdict, summary, findings, body_markdown, branch, commit_sha, commit_short_sha, commit_message, files_reviewed, pr_number, pr_url, log, status, error_message, triggered_by, created_at, updated_at'
          )
          .eq('id', row.id)
          .maybeSingle()
        if (error) {
          setLatestReview(null)
          return
        }
        setLatestReview((review as LatestReview | null) ?? null)
      } finally {
        setLatestReviewLoading(false)
      }
    },
    [supabase]
  )

  // While the modal is open and the latest review is still pending, poll
  // every 1.5s so the user can see Dwight's step-by-step progress without
  // leaving the board. The poll is scoped to the current taskId so it
  // stops as soon as the modal closes.
  useEffect(() => {
    if (!editingTask) return;
    if (!latestReview || latestReview.status !== 'pending') return;
    const handle = setInterval(() => {
      void loadLatestReview(editingTask.id);
    }, 1500);
    return () => clearInterval(handle);
  }, [editingTask, latestReview, loadLatestReview]);

  // Persist any edits from the detail modal back to Supabase and update
  // local state so the kanban board reflects the change immediately.
  const handleSaveEdit = async () => {
    if (!editingTask) return
    if (!editTitle.trim()) {
      setEditError('Title cannot be empty.')
      return
    }

    setSavingEdit(true)
    setEditError('')

    // Derive a status string from the destination column. This mirrors
    // handleMoveTask so that the "status" enum stays in sync with the
    // visible column name. Dropping the task into the Done column puts it
    // into the Dwight-owned "under_review" state; Dwight is the only path
    // to "done".
    const targetColumn = columns.find((c) => c.id === editColumn)
    let newStatus: 'todo' | 'in_progress' | 'under_review' | 'done' | 'blocked' = editingTask.status as any
    if (targetColumn) {
      const colName = targetColumn.name.toLowerCase()
      if (colName.includes('done') || colName.includes('closed') || colName.includes('complete')) {
        newStatus = 'under_review'
      } else if (colName.includes('progress') || colName.includes('review') || colName.includes('testing')) {
        newStatus = 'in_progress'
      } else if (colName.includes('block')) {
        newStatus = 'blocked'
      } else {
        newStatus = 'todo'
      }
    }

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          priority: editPriority,
          column_id: editColumn,
          assignee_id: editAssignee || null,
          status: newStatus,
        })
        .eq('id', editingTask.id)

      if (error) throw error

      // Look up the new assignee's profile so the avatar / name stay
      // correct on the board without another network round-trip.
      let assigneeProfile: Task['profiles'] | undefined
      if (editAssignee) {
        const newAssignee = projectMembers.find((m) => m.user_id === editAssignee)
        assigneeProfile = newAssignee
          ? { name: newAssignee.profiles.name, avatar_url: null }
          : editingTask.profiles && editAssignee === editingTask.assignee_id
          ? editingTask.profiles
          : undefined
      } else {
        assigneeProfile = undefined
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTask.id
            ? {
                ...t,
                title: editTitle.trim(),
                description: editDescription.trim() || null,
                priority: editPriority,
                column_id: editColumn,
                assignee_id: editAssignee || null,
                status: newStatus,
                profiles: assigneeProfile as Task['profiles'],
              }
            : t
        )
      )

      // Dwight auto-fires whenever an edit flips a task to "under_review".
      if (newStatus === 'under_review' && editingTask.status !== 'under_review') {
        fireDwightReview(editingTask.id)
      }

      setEditingTask(null)
    } catch (err: any) {
      setEditError(err.message || 'Failed to save task changes')
    } finally {
      setSavingEdit(false)
    }
  }

  // Delete from the detail modal — no confirm() because the user is
  // already committed to the action by clicking Delete inside the modal.
  const handleDeleteFromDetail = async () => {
    if (!editingTask) return
    if (!confirm('Delete this task? This cannot be undone.')) return

    try {
      const { error } = await supabase.from('tasks').delete().eq('id', editingTask.id)
      if (error) throw error
      setTasks((prev) => prev.filter((t) => t.id !== editingTask.id))
      setEditingTask(null)
    } catch (err: any) {
      setEditError(err.message || 'Failed to delete task')
    }
  }

  // Parse a GitHub PR URL into { number, branch }.
  //   https://github.com/owner/repo/pull/42               → { number: 42, branch: null }
  //   https://github.com/owner/repo/pull/42/files         → { number: 42, branch: null }
  //   https://github.com/owner/repo/pull/42/commits       → { number: 42, branch: null }
  // Branch is fetched from the GitHub API at link time so we don't have
  // to require the user to type it.
  function parsePrUrl(input: string): { number: number } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? { number: n } : null;
  }

  async function handleLinkPr(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTask || !project) return;
    setPrLinkError('');

    const parsed = parsePrUrl(prUrlDraft);
    if (!parsed) {
      setPrLinkError('That doesn\u2019t look like a GitHub PR URL.');
      return;
    }

    setLinkingPr(true);
    try {
      // Fetch the PR so we can record its head branch. This also doubles
      // as a live existence check — if GitHub 404s, the link fails.
      const { data: profile } = await supabase
        .from('profiles')
        .select('github_token')
        .eq('id', currentUserId)
        .single();
      if (!profile?.github_token) {
        setPrLinkError('Connect GitHub in Settings first.');
        setLinkingPr(false);
        return;
      }
      // We need the repo owner/name to call the PR API. The project's
      // repo_url is the source of truth here.
      const repoUrl = project.repo_url;
      if (!repoUrl) {
        setPrLinkError('Link a GitHub repo to this project first.');
        setLinkingPr(false);
        return;
      }
      const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
      if (!repoMatch) {
        setPrLinkError('Project repo URL is malformed.');
        setLinkingPr(false);
        return;
      }
      const [, owner, repo] = repoMatch;
      const prRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${parsed.number}`,
        {
          headers: {
            Authorization: `Bearer ${profile.github_token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          cache: 'no-store',
        }
      );
      if (!prRes.ok) {
        // 401 / 403 from GitHub means the stored token is no longer
        // accepted. Surface a one-click re-auth modal instead of a dead
        // error message.
        if (prRes.status === 401 || prRes.status === 403) {
          setGithubReauth({
            code: 'GITHUB_REAUTH_REQUIRED',
            error: 'Your GitHub connection is no longer valid. Reconnect to continue.',
            authorizeUrl: `/api/auth/github/authorize?return_to=${encodeURIComponent(
              typeof window !== 'undefined' ? window.location.pathname : `/projects/${projectId}`
            )}`,
          });
          setGithubReauthAction('linking a pull request');
        } else {
          setPrLinkError(`GitHub returned ${prRes.status} for that PR.`);
        }
        setLinkingPr(false);
        return;
      }
      const pr = await prRes.json();
      const branch: string | null = pr?.head?.ref ?? null;
      const url: string = pr?.html_url || prUrlDraft.trim();

      const { data, error } = await supabase
        .from('tasks')
        .update({
          pr_url: url,
          pr_number: parsed.number,
          pr_branch: branch,
        })
        .eq('id', editingTask.id)
        .select('id, pr_url, pr_number, pr_branch, display_id')
        .single();
      if (error || !data) throw error || new Error('Update failed');

      // Mirror to local state + the editingTask object so the modal
      // immediately reflects the new values.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTask.id
            ? { ...t, pr_url: data.pr_url, pr_number: data.pr_number, pr_branch: data.pr_branch }
            : t
        )
      );
      setEditingTask((prev) =>
        prev
          ? { ...prev, pr_url: data.pr_url, pr_number: data.pr_number, pr_branch: data.pr_branch }
          : prev
      );
      setPrUrlDraft(data.pr_url || '');
    } catch (err) {
      setPrLinkError(err instanceof Error ? err.message : 'Failed to link PR');
    } finally {
      setLinkingPr(false);
    }
  }

  async function handleUnlinkPr() {
    if (!editingTask) return;
    setLinkingPr(true);
    setPrLinkError('');
    try {
      const { data, error } = await supabase
        .from('tasks')
        .update({ pr_url: null, pr_number: null, pr_branch: null })
        .eq('id', editingTask.id)
        .select('id, pr_url, pr_number, pr_branch')
        .single();
      if (error || !data) throw error || new Error('Unlink failed');
      setTasks((prev) =>
        prev.map((t) =>
          t.id === editingTask.id
            ? { ...t, pr_url: null, pr_number: null, pr_branch: null }
            : t
        )
      );
      setEditingTask((prev) =>
        prev
          ? { ...prev, pr_url: null, pr_number: null, pr_branch: null }
          : prev
      );
    } catch (err) {
      setPrLinkError(err instanceof Error ? err.message : 'Failed to unlink PR');
    } finally {
      setLinkingPr(false);
    }
  }

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setRepoError('')

    try {
      if (!currentUserId) throw new Error('Not authenticated')
      if (!project) throw new Error('Project not loaded')

      const res = await fetch(`/api/projects/${projectId}/github/create-repo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: repoName.trim() || project.name,
          description: repoDescription.trim() || project.description || '',
          private: repoPrivate,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        // GITHUB_REAUTH_REQUIRED + GITHUB_NOT_CONNECTED + the legacy
        // GITHUB_TOKEN_INVALID all map to the same one-click modal.
        if (
          data.code === 'GITHUB_REAUTH_REQUIRED' ||
          data.code === 'GITHUB_NOT_CONNECTED' ||
          data.code === 'GITHUB_TOKEN_INVALID'
        ) {
          setGithubReauth({
            code: data.code,
            error: data.error,
            authorizeUrl: data.authorizeUrl,
          })
          setGithubReauthAction('creating a GitHub repo')
          // Keep the inline error empty so the modal is the only message.
          setRepoError('')
        } else if (data.code === 'GITHUB_RATE_LIMIT') {
          setRepoError(data.error)
        } else if (data.code === 'REPO_NAME_TAKEN' || data.code === 'GITHUB_VALIDATION_FAILED') {
          // Surface GitHub's field-level message inline so the user knows
          // exactly what to change (e.g. "name already exists on this account").
          setRepoError(data.error || 'GitHub rejected the repository details.')
        } else {
          throw new Error(data.error || 'Failed to create GitHub repo')
        }
        return
      }

      setProject((prev) => {
        if (!prev) return prev
        return { ...prev, repo_url: data.repo_url }
      })
      setShowCreateRepoModal(false)
    } catch (err: any) {
      setRepoError(err.message || 'Failed to create GitHub repo')
    } finally {
      setCreatingRepo(false)
    }
  }

  const handleCompleteTask = async (taskId: string) => {
    try {
      const doneColumn = columns.find((c) => c.name.toLowerCase().includes('done'))
      if (!doneColumn) {
        alert('No "Done" column found')
        return
      }

      // "Mark as done" now lands the task in Dwight's review queue rather
      // than directly in `done`. Dwight is the only thing that flips the
      // status to `done` once the review approves the work.
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'under_review',
          column_id: doneColumn.id,
        })
        .eq('id', taskId)

      if (error) throw error

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'under_review', column_id: doneColumn.id } : t
        )
      )

      // Dwight auto-fires on every explicit "mark as done".
      fireDwightReview(taskId)
    } catch (err: any) {
      alert(err.message || 'Failed to complete task')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Project not found'}</p>
          <Link
            href="/dashboard"
            className="text-purple-600 dark:text-purple-400 hover:underline"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const openTasksCount = tasks.filter((t) => t.status !== 'done').length
  const capacityRemaining = project.max_open_tasks - openTasksCount
  const capacityPercent = (openTasksCount / project.max_open_tasks) * 100

  const isProjectOwner = project.owner_id === currentUserId
  const isDraft = project.status === 'draft'
  // While in draft, only the owner can create or move tasks. Everyone else
  // gets a read-only view of the board (per design choice: "read-only board
  // for devs while in planning").
  const canEditTasks = isProjectOwner || !isDraft

  // Days remaining until the deadline (negative = overdue). Null when no
  // deadline is set.
  const deadlineDate = project.deadline ? new Date(project.deadline) : null
  const daysUntilDeadline = deadlineDate
    ? Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-7xl mx-auto pt-6 pb-16">
        {/* Header */}
        <div className="mb-6 animate-slide-down">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-4 transition-all duration-300"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-300 group-hover:-translate-x-1" />
            Back to Dashboard
          </Link>

          <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-700 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                    {project.name}
                  </h1>
                  <span
                    className={`relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all duration-300 hover:scale-105 ${
                      project.status === 'active'
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30'
                        : project.status === 'draft'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                        : project.status === 'on_hold'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {project.status === 'active' && (
                      <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-white">
                        <span className="absolute inset-0 rounded-full bg-white animate-ping opacity-75" />
                      </span>
                    )}
                    {project.status === 'on_hold' ? 'On Hold' : project.status}
                  </span>
                  {isProjectOwner && (
                    <div className="relative inline-block">
                      <button
                        onClick={() => setShowProjectActions(!showProjectActions)}
                        className="px-3 py-1 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        ⋯ Actions
                      </button>
                      {showProjectActions && (
                        <div className="absolute right-0 top-8 z-10 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[160px]">
                          <button
                            onClick={() => { handleFinishProject(); setShowProjectActions(false) }}
                            disabled={finishing || project.status === 'archived'}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            {finishing ? 'Finishing...' : 'Finish Project'}
                          </button>
                          <button
                            onClick={() => { handleDeleteProject(); setShowProjectActions(false) }}
                            disabled={deleting}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          >
                            {deleting ? 'Deleting...' : 'Delete Project'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {deadlineDate && (
                    <span
                      title={deadlineDate.toLocaleString()}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-300 hover:scale-105 ${
                        daysUntilDeadline !== null && daysUntilDeadline < 0
                          ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white border-transparent shadow-md shadow-red-500/30 animate-pulse-glow'
                          : daysUntilDeadline !== null && daysUntilDeadline <= 3
                          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                          : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
                      }`}
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      {daysUntilDeadline !== null && daysUntilDeadline < 0
                        ? `Overdue by ${Math.abs(daysUntilDeadline)}d`
                        : daysUntilDeadline === 0
                        ? 'Due today'
                        : daysUntilDeadline === 1
                        ? 'Due tomorrow'
                        : `${daysUntilDeadline}d to deadline`}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">
                  Team: {project.teams.name}
                  {project.profiles?.name && (
                    <>
                      {' · '}
                      Owned by{' '}
                      {project.profiles.github_username ? (
                        <a
                          href={`https://github.com/${project.profiles.github_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          <GithubIcon className="w-3.5 h-3.5" />
                          @{project.profiles.github_username}
                        </a>
                      ) : (
                        <span className="font-medium">{project.profiles.name}</span>
                      )}
                    </>
                  )}
                </p>
                {project.description && (
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    {project.description}
                  </p>
                )}
                {project.repo_url && (
                  <a
                    href={project.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2 mt-3 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95"
                  >
                    <GithubIcon className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                    <span className="max-w-[22rem] truncate">
                      {project.repo_url.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </span>
                    <ExternalLink className="w-3 h-3 opacity-60 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </a>
                )}
                {!project.repo_url && (
                  <button
                    onClick={() => {
                      setRepoName(project.name)
                      setRepoDescription(project.description || '')
                      setRepoPrivate(true)
                      setRepoError('')
                      setShowCreateRepoModal(true)
                    }}
                    className="group inline-flex items-center gap-2 mt-3 px-3 py-1.5 text-xs font-semibold text-white bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95 hover:shadow-lg"
                  >
                    <GithubIcon className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                    Create GitHub Repo
                  </button>
                )}
              </div>
              <button
                onClick={openNewTaskModal}
                disabled={capacityRemaining <= 0 || !canEditTasks}
                className="group flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                title={
                  !canEditTasks
                    ? 'Read-only while the project is in planning — only the owner can plan tasks'
                    : capacityRemaining <= 0
                    ? 'At capacity — complete or remove tasks first'
                    : 'Create new issue'
                }
              >
                {!canEditTasks ? (
                  <Lock className="w-5 h-5" />
                ) : (
                  <Plus className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" />
                )}
                {canEditTasks ? 'Create Issue' : 'Read-only'}
              </button>
            </div>

            {/* Capacity Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-700 dark:text-gray-300 font-medium">
                  WIP Capacity
                </span>
                <span
                  className={`font-bold ${
                    capacityRemaining > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {openTasksCount} / {project.max_open_tasks} open tasks
                  {capacityRemaining > 0
                    ? ` (${capacityRemaining} remaining)`
                    : ' (at capacity!)'}
                </span>
              </div>
              <div className="relative w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-700 bar-fill relative overflow-hidden ${
                    capacityPercent > 90
                      ? 'bg-gradient-to-r from-red-500 via-rose-500 to-red-500 bg-[length:200%_200%] animate-gradient-x'
                      : capacityPercent > 70
                      ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 bg-[length:200%_200%] animate-gradient-x'
                      : 'bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-[length:200%_200%] animate-gradient-x'
                  }`}
                  style={{ width: `${Math.min(capacityPercent, 100)}%` }}
                >
                  {/* shimmer overlay travelling across the bar */}
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent bg-[length:200%_100%] animate-shimmer pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Planning banner — only renders while the project is in draft */}
        {isDraft && (
          <div
            className={`rounded-2xl border p-5 mb-6 animate-slide-down transition-all duration-300 ${
              readiness?.can_start
                ? 'bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 bg-[length:200%_200%] animate-gradient-x dark:from-emerald-900/20 dark:via-teal-900/20 dark:to-emerald-900/20 border-emerald-200 dark:border-emerald-800 shadow-lg shadow-emerald-500/10'
                : 'bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 bg-[length:200%_200%] animate-gradient-x dark:from-amber-900/20 dark:via-orange-900/20 dark:to-amber-900/20 border-amber-200 dark:border-amber-800'
            }`}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="flex items-center gap-2 mb-1">
                  {readiness?.can_start ? (
                    <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  )}
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {readiness?.can_start
                      ? 'Ready to start — every task is assigned'
                      : 'Planning mode'}
                  </h2>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {isProjectOwner
                    ? 'Assign tasks to your team, set a deadline, then click Start Project to flip the board live.'
                    : 'Your team owner is still planning. The board below is read-only until the project goes live — assigned tasks will show up on your dashboard when it starts.'}
                </p>

                {/* Checklist the owner can tick off in their head */}
                {isProjectOwner && readiness && (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    <li className="flex items-center gap-2">
                      <span
                        className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold ${
                          readiness.has_deadline
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {readiness.has_deadline ? '✓' : '•'}
                      </span>
                      <span className={readiness.has_deadline ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                        Set a deadline
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold ${
                          readiness.total_tasks > 0
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {readiness.total_tasks > 0 ? '✓' : '•'}
                      </span>
                      <span className={readiness.total_tasks > 0 ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                        Create at least one task
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={`inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] font-bold ${
                          readiness.unassigned_tasks === 0 && readiness.total_tasks > 0
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {readiness.unassigned_tasks === 0 && readiness.total_tasks > 0 ? '✓' : '•'}
                      </span>
                      <span className={readiness.unassigned_tasks === 0 && readiness.total_tasks > 0 ? 'text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                        Assign every task
                        {readiness.unassigned_tasks > 0 && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {' '}— {readiness.unassigned_tasks} left
                          </span>
                        )}
                      </span>
                    </li>
                  </ul>
                )}

                {startError && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                    {startError}
                  </p>
                )}
              </div>

              {/* Right column: deadline editor + Start button (owner only) */}
              {isProjectOwner && (
                <div className="flex flex-col items-stretch gap-2 min-w-[220px]">
                  {editingDeadline ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={deadlineDraft}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setDeadlineDraft(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                      <button
                        onClick={saveDeadline}
                        disabled={savingDeadline}
                        className="px-3 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                      >
                        {savingDeadline ? '...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingDeadline(false)}
                        className="px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={beginEditDeadline}
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
                    >
                      <CalendarClock className="w-4 h-4" />
                      {project.deadline ? 'Change deadline' : 'Set deadline'}
                    </button>
                  )}

                  <button
                    onClick={handleStartProject}
                    disabled={!readiness?.can_start || starting}
                    className={`group inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg shadow-md transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                      readiness?.can_start
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 animate-pulse-glow'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    title={
                      !readiness?.can_start
                        ? 'Resolve the checklist above before starting'
                        : 'Flip this project from Planning to Active'
                    }
                  >
                    {starting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    )}
                    {starting ? 'Starting...' : 'Start Project'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-4 animate-slide-down">
          <button
            onClick={() => setActiveTab('board')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'board'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <LayoutDashboard className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'board' ? 'rotate-3' : 'group-hover:rotate-3'}`} />
            Board
          </button>
          <button
            onClick={() => setActiveTab('jim')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'jim'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <BotIcon className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'jim' ? 'animate-bounce-soft' : 'group-hover:scale-110'}`} />
            Jim
          </button>
          <button
            onClick={() => setActiveTab('michael')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'michael'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <Briefcase className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'michael' ? 'rotate-12' : 'group-hover:rotate-12'}`} />
            Michael
          </button>
          <button
            onClick={() => setActiveTab('dwight')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'dwight'
                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <ShieldAlert className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'dwight' ? 'rotate-6' : 'group-hover:rotate-6'}`} />
            Dwight
          </button>
          <button
            onClick={() => setActiveTab('pam')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'pam'
                ? 'bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white shadow-lg shadow-fuchsia-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <Radar className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'pam' ? 'rotate-12' : 'group-hover:rotate-12'}`} />
            Pam
          </button>
          <button
            onClick={() => setActiveTab('commits')}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 hover:scale-105 active:scale-95 ${
              activeTab === 'commits'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/40'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md'
            }`}
          >
            <GitCommit className={`w-4 h-4 transition-transform duration-300 ${activeTab === 'commits' ? 'rotate-12' : 'group-hover:rotate-12'}`} />
            Commits
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'board' && (
          <>
            {/* Kanban Board — flex layout so columns share the full width evenly.
                overflow-x-auto kicks in only when the viewport can't fit every
                column at its min-width (e.g. 5+ columns on a phone). */}
            <div className="flex gap-4 w-full pb-4 stagger-children items-stretch overflow-x-auto">
              {columns.map((column, colIdx) => {
                const columnTasks = tasks.filter((t) => t.column_id === column.id)
                const isDragOver = dragOverColumn === column.id
                const nextColumn = columns[colIdx + 1]
                const accent = getColumnAccent(column.name)
                const ColumnIcon = getColumnIcon(column.name)
                const isDoneColumn = column.name.toLowerCase().includes('done') ||
                  column.name.toLowerCase().includes('closed') ||
                  column.name.toLowerCase().includes('complete')

                return (
                  <div
                    key={column.id}
                    style={{ ['--i' as any]: colIdx }}
                    onDragOver={(e) => handleDragOver(e, column.id)}
                    onDragLeave={() => handleDragLeave(column.id)}
                    onDrop={(e) => handleDrop(e, column.id)}
                    className={`group/col relative flex flex-col flex-1 min-w-[260px] bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-lg p-4 border transition-all duration-300 min-h-[calc(100vh-22rem)] ${
                      isDragOver
                        ? `border-purple-500 ring-2 ring-purple-500/40 drop-glow bg-purple-50/40 dark:bg-purple-950/40 scale-[1.01] ${accent.ring} shadow-2xl`
                        : 'border-gray-100 dark:border-gray-700 hover:shadow-xl'
                    }`}
                  >
                    {/* Animated top gradient strip — adds a "live" feel to each column */}
                    <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-gradient-to-r ${accent.bar} bg-[length:200%_200%] animate-gradient-x`} />

                    {/* Column Header */}
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-700/50">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`relative flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br ${accent.bar} flex items-center justify-center text-white shadow-md ${accent.ring} transition-transform duration-300 group-hover/col:scale-110 group-hover/col:rotate-3`}>
                          <ColumnIcon className="w-4 h-4" />
                          {!isDoneColumn && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white shadow-sm">
                              <span className={`absolute inset-0 rounded-full ${accent.dot.split(' ')[0]} animate-ping opacity-75`} />
                            </span>
                          )}
                        </div>
                        <h3 className={`text-sm font-bold uppercase tracking-wide truncate ${accent.text}`}>
                          {column.name}
                        </h3>
                        <span className={`flex-shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 text-[10px] font-bold rounded-full bg-gradient-to-br ${accent.bar} text-white shadow-sm`}>
                          {columnTasks.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {canEditTasks && (
                          <button
                            onClick={() => {
                              // Stage selector lives on each card; this shortcut
                              // jumps the user straight to the "Add Task" modal
                              // pre-filled with this column as the destination.
                              openNewTaskModal()
                            }}
                            title="Add task to this column"
                            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:text-purple-600 dark:hover:text-purple-400 hover:scale-110 active:scale-95 transition-all duration-300"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          title="Column options"
                          className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:scale-110 active:scale-95 transition-all duration-300"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Tasks / empty state — flex-1 so it fills any remaining space */}
                    <div className="flex-1 flex flex-col gap-3">
                      <div className="space-y-3">
                        {columnTasks.map((task, taskIdx) => {
                          const isUrgent = task.priority === 'urgent'
                          return (
                          <div
                            key={task.id}
                            style={{ ['--i' as any]: taskIdx }}
                            draggable={canEditTasks}
                            onDragStart={(e) => handleDragStart(e, task)}
                            onClick={(e) => {
                              // Open the detail modal on any click that
                              // didn't land inside an interactive control
                              // (button / select / anchor). Those still
                              // behave normally because the inner onClick
                              // handlers fire before this guard runs.
                              const target = e.target as HTMLElement
                              if (target.closest('button, select, a, input, textarea, option')) return
                              openTaskDetail(task)
                            }}
                            title="Click to view or edit"
                            className={`animate-slide-up relative bg-white dark:bg-gray-700/60 rounded-xl p-3 border border-gray-200 dark:border-gray-600 hover:shadow-xl transition-all duration-300 group ${
                              priorityAccent[task.priority] || ''
                            } ${
                              canEditTasks
                                ? 'cursor-grab active:cursor-grabbing hover:-translate-y-1 hover:scale-[1.02]'
                                : 'cursor-pointer'
                            } ${
                              isUrgent
                                ? 'ring-1 ring-rose-300/60 dark:ring-rose-400/40 animate-pulse-glow'
                                : ''
                            }`}
                          >
                            {/* Priority accent stripe — gives each card a coloured
                                left edge that hints at urgency at a glance. */}
                            <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${
                              task.priority === 'urgent'
                                ? 'bg-gradient-to-b from-red-500 to-rose-500'
                                : task.priority === 'high'
                                ? 'bg-gradient-to-b from-amber-400 to-orange-400'
                                : task.priority === 'medium'
                                ? 'bg-gradient-to-b from-blue-400 to-cyan-400'
                                : 'bg-gradient-to-b from-gray-300 to-gray-400 dark:from-gray-500 dark:to-gray-600'
                            }`} />

                            <div className="flex items-start justify-between mb-1.5 pl-2">
                              <div className="flex items-start gap-1 flex-1 min-w-0">
                                <GripVertical
                                  className={`w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0 transition-opacity ${
                                    canEditTasks ? 'opacity-0 group-hover:opacity-100' : 'opacity-30'
                                  }`}
                                />
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  {task.display_id && (
                                    <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                                      {task.display_id}
                                    </span>
                                  )}
                                  <h4 className="text-[13px] font-bold text-gray-900 dark:text-white leading-snug">
                                    {task.title}
                                  </h4>
                                </div>
                              </div>
                              {canEditTasks && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-1 group-hover:translate-x-0 flex-shrink-0 ml-1">
                                  {nextColumn && (
                                    <button
                                      onClick={() => handleMoveTask(task.id, nextColumn.id)}
                                      className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:scale-110 active:scale-95 transition-all"
                                      title={`Move to ${nextColumn.name}`}
                                    >
                                      <ChevronRight className="w-4 h-4" />
                                    </button>
                                  )}
                                  {task.status !== 'done' && task.status !== 'under_review' && (
                                    <button
                                      onClick={() => handleCompleteTask(task.id)}
                                      className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 hover:scale-110 active:scale-95 transition-all"
                                      title="Mark as done"
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 hover:scale-110 active:scale-95 transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Dwight review status row — shown when the task is
                                actively under review, has been reviewed already,
                                or the PR search came back empty (PR not found). */}
                            {(task.status === 'under_review' || task.last_review_verdict || prNotFoundTaskIds.has(task.id)) && (
                              <div className="pl-3 mb-1.5">
                                {prNotFoundTaskIds.has(task.id) ? (
                                  // PR search returned no matching PR — task was
                                  // bounced back to in-progress by the server.
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                    title={`No GitHub PR found with "${task.display_id}" in the title. Dwight did not run.`}
                                  >
                                    <GitPullRequest className="w-3 h-3" />
                                    PR not found
                                  </span>
                                ) : task.status === 'under_review' ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                    title="Dwight is searching for a matching PR and reviewing it."
                                  >
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Searching PR…
                                  </span>
                                ) : task.last_review_verdict === 'approved' ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                    title="Dwight approved this task."
                                  >
                                    <ShieldCheck className="w-3 h-3" />
                                    Approved
                                  </span>
                                ) : task.last_review_verdict === 'changes_requested' ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                                    title="Dwight requested changes on the latest commit."
                                  >
                                    <ShieldAlert className="w-3 h-3" />
                                    Changes requested
                                  </span>
                                ) : task.last_review_verdict === 'comment' ? (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                                    title="Dwight left a comment on the latest commit."
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    Comment
                                  </span>
                                ) : null}
                              </div>
                            )}

                            {task.description && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2.5 line-clamp-2 pl-3">
                                {task.description}
                              </p>
                            )}

                            <div className="flex items-center justify-between pl-3 pt-2 border-t border-gray-100/70 dark:border-gray-700/40">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border border-transparent capitalize ${
                                    priorityColors[task.priority]
                                  } ${
                                    isUrgent ? 'animate-pulse-glow' : ''
                                  }`}
                                >
                                  <span className={isUrgent ? 'text-shimmer' : ''}>
                                    {task.priority}
                                  </span>
                                </span>

                                {/* PR chip — only when a PR is linked to the task. */}
                                {task.pr_number && (
                                  <a
                                    href={task.pr_url || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                                    title={`PR #${task.pr_number}${task.pr_branch ? ` (${task.pr_branch})` : ''}`}
                                  >
                                    <GitPullRequest className="w-3 h-3" />
                                    #{task.pr_number}
                                  </a>
                                )}

                                {/* Stage selector dropdown — disabled for read-only viewers */}
                                <select
                                  value={task.column_id}
                                  onChange={(e) => handleMoveTask(task.id, e.target.value)}
                                  disabled={!canEditTasks}
                                  className="text-[10px] font-semibold bg-gray-100/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-md px-1.5 py-0.5 outline-none cursor-pointer hover:border-purple-400 hover:bg-purple-50 dark:hover:border-purple-500 dark:hover:bg-purple-950/50 hover:text-purple-700 dark:hover:text-purple-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {columns.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {task.profiles ? (
                                <div
                                  className="flex items-center gap-1.5 flex-shrink-0"
                                  title={`Assigned to ${task.profiles.name}`}
                                >
                                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-[10px] ring-2 ring-white dark:ring-gray-700 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                                    {task.profiles.name.charAt(0).toUpperCase()}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          )
                        })}
                      </div>

                      {/* Empty state — flex-1 so it fills the remaining column height */}
                      {columnTasks.length === 0 && (
                        <div
                          className={`relative flex-1 min-h-[260px] flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-all duration-500 overflow-hidden ${
                            isDragOver
                              ? 'border-purple-500 bg-gradient-to-br from-purple-50/80 to-pink-50/60 dark:from-purple-950/40 dark:to-pink-950/30 text-purple-600 dark:text-purple-300 scale-[1.01] drop-glow'
                              : 'border-gray-200/80 dark:border-gray-700/60 text-gray-400 dark:text-gray-500 hover:border-purple-300/60 hover:bg-purple-50/20 dark:hover:bg-purple-950/10'
                          }`}
                        >
                          {/* Decorative floating orbs that gently drift in the background */}
                          <div className="absolute inset-0 pointer-events-none overflow-hidden">
                            <div className={`absolute top-6 left-6 w-2 h-2 rounded-full bg-gradient-to-br ${accent.bar} opacity-50 animate-float`} />
                            <div className={`absolute bottom-10 right-8 w-3 h-3 rounded-full bg-gradient-to-br ${accent.bar} opacity-40 animate-float-slow`} />
                            <div className={`absolute top-1/3 right-12 w-1.5 h-1.5 rounded-full bg-gradient-to-br ${accent.bar} opacity-30 animate-float`} />
                            <div className={`absolute bottom-1/4 left-1/4 w-1 h-1 rounded-full bg-gradient-to-br ${accent.bar} opacity-60 animate-float-slow`} />
                          </div>

                          {/* Main illustration */}
                          <div className="relative">
                            <div className={`absolute inset-0 bg-gradient-to-br ${accent.bar} opacity-20 blur-2xl rounded-full animate-pulse`} />
                            <div className={`relative w-20 h-20 rounded-2xl bg-gradient-to-br ${accent.bar} flex items-center justify-center text-white shadow-xl ${accent.ring} transition-transform duration-500 ${isDragOver ? 'scale-110 rotate-6' : ''}`}>
                              {isDragOver ? (
                                <ChevronDown className="w-9 h-9 animate-bounce" />
                              ) : (
                                <ColumnIcon className="w-9 h-9" />
                              )}
                            </div>
                          </div>

                          <div className="text-center relative px-4">
                            <p className={`text-sm font-bold ${isDragOver ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-300'}`}>
                              {isDragOver ? 'Release to drop' : 'Nothing here yet'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-[200px]">
                              {isDragOver
                                ? 'This task will land in ' + column.name
                                : canEditTasks
                                ? 'Drag a task here or click + to add one'
                                : 'Tasks will appear here as work progresses'}
                            </p>
                          </div>

                          {canEditTasks && !isDragOver && (
                            <button
                              onClick={openNewTaskModal}
                              className="group relative inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-xl shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-300"
                            >
                              <Plus className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-90" />
                              Add task
                            </button>
                          )}
                        </div>
                      )}

                      {/* Bottom Add Task button — always present so empty columns
                          still have a CTA, but only when the user can edit. */}
                      {canEditTasks && columnTasks.length > 0 && (
                        <button
                          onClick={openNewTaskModal}
                          className="group mt-auto w-full p-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-950/30 hover:shadow-sm transition-all duration-300 flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400"
                        >
                          <Plus className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-90" />
                          Add task
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {activeTab === 'jim' && project && (
          <JimPanel
            projectId={projectId}
            projectName={project.name}
            projectDescription={project.description || ''}
            hasRepo={!!project.repo_url}
            projectKey={project.key}
            onDescriptionUpdate={handleDescriptionUpdate}
            onTitleUpdate={handleTitleUpdate}
            onKeyUpdate={handleKeyUpdate}
          />
        )}

        {activeTab === 'michael' && project && (
          <MichaelPanel
            projectId={projectId}
            projectName={project.name}
            projectDescription={project.description || ''}
            hasRepo={!!project.repo_url}
            teamMembers={projectMembers.map((m) => ({
              user_id: m.user_id,
              name: m.profiles?.name ?? 'Unknown',
              specialization: m.profiles?.specialization?.trim() || null,
            }))}
            onTasksCreated={() => {
              // Refresh the board so the new tasks appear immediately.
              loadProjectData()
            }}
          />
        )}

        {activeTab === 'dwight' && project && (
          <DwightPanel
            projectId={projectId}
            hasRepo={!!project.repo_url}
            repoUrl={project.repo_url}
            freshlyDoneTask={freshlyDoneTask}
            onClearFreshlyDoneTask={clearFreshlyDoneTask}
            onTaskChanged={loadProjectData}
            onPrNotFound={handlePrNotFound}
          />
        )}

        {activeTab === 'pam' && project && (
          <PamPanel
            projectId={projectId}
            projectName={project.name}
            projectDescription={project.description || ''}
          />
        )}

        {activeTab === 'commits' && project && (
          <CommitHistorySection projectId={projectId} />
        )}
      </div>

      {/* New Task Modal */}
      {showNewTaskModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={() => setShowNewTaskModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Create New Issue
            </h2>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label
                  htmlFor="title"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Issue Title *
                </label>
                <input
                  id="title"
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  required
                  placeholder="Implement user authentication"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Description (Optional)
                </label>
                <textarea
                  id="description"
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  rows={3}
                  placeholder="Add details about requirements, acceptance criteria..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Priority
                </label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewTaskPriority(p)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-all duration-300 hover:scale-105 active:scale-95 ${
                        newTaskPriority === p
                          ? priorityColors[p] + ' ring-2 ring-purple-500 scale-105 shadow-md animate-pop'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="assignee"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Assign To (Optional)
                </label>
                <select
                  id="assignee"
                  value={selectedAssignee}
                  onChange={(e) => {
                    setSelectedAssignee(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="">Unassigned</option>
                  <optgroup label="Team Members">
                    {projectMembers.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.profiles.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Issues start in "To Do" - assignees can move them through stages
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:scale-[1.02] active:scale-95 transition-all duration-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="group flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                      Create Issue
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Detail / Edit Modal — opens when a card is clicked. Read-only
          viewers get a read-only inspector; users with canEditTasks get the
          full edit form (title, description, priority, column, assignee). */}
      {editingTask && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={closeTaskDetail}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-scale-in max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br ${getColumnAccent(columns.find((c) => c.id === editColumn)?.name || '').bar} flex items-center justify-center text-white shadow-md`}>
                  {canEditTasks ? (
                    <Pencil className="w-4 h-4" />
                  ) : (
                    <UserCheck className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {canEditTasks ? 'Edit Task' : 'Task Details'}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {columns.find((c) => c.id === editColumn)?.name || 'No column'}
                  </p>
                </div>
              </div>
              <button
                onClick={closeTaskDetail}
                className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:scale-110 active:scale-95 transition-all duration-300 flex-shrink-0"
                title="Close"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm animate-slide-down">
                {editError}
              </div>
            )}

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={!canEditTasks}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  disabled={!canEditTasks}
                  rows={3}
                  placeholder="No description"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none resize-none disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                />
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  Priority
                </label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={!canEditTasks}
                      onClick={() => setEditPriority(p)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold capitalize transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                        editPriority === p
                          ? priorityColors[p] + ' ring-2 ring-purple-500 scale-105 shadow-md'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column / Stage */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Column
                </label>
                <select
                  value={editColumn}
                  onChange={(e) => setEditColumn(e.target.value)}
                  disabled={!canEditTasks}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Assignee
                </label>
                <select
                  value={editAssignee}
                  onChange={(e) => {
                    setEditAssignee(e.target.value);
                  }}
                  disabled={!canEditTasks}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  <optgroup label="Team Members">
                    {projectMembers.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.profiles.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {editAssignee && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-[10px]">
                      {projectMembers
                        .find((m) => m.user_id === editAssignee)
                        ?.profiles.name.charAt(0)
                        .toUpperCase() || '?'}
                    </div>
                    <span>Will be assigned to {projectMembers.find((m) => m.user_id === editAssignee)?.profiles.name || 'this user'}</span>
                  </div>
                )}
              </div>

              {/* Meta footer */}
              <div className="pt-3 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
                {editingTask.display_id && (
                  <p>
                    Task id:{' '}
                    <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
                      {editingTask.display_id}
                    </span>
                  </p>
                )}
                {editingTask.created_at && (
                  <p>Created: {new Date(editingTask.created_at).toLocaleString()}</p>
                )}
                <p>Status: <span className="font-semibold text-gray-700 dark:text-gray-300">{editingTask.status}</span></p>
              </div>

              {/* Linked GitHub PR — Dwight reviews this diff when the task
                  is moved to done. The user can paste a PR URL or clear
                  the link from here. */}
              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <GitPullRequest className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                    Linked pull request
                  </h3>
                </div>

                {editingTask.pr_number ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <a
                        href={editingTask.pr_url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        PR #{editingTask.pr_number}
                      </a>
                      {editingTask.pr_branch && (
                        <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                          {editingTask.pr_branch}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Dwight will review this PR&apos;s diff when the task is moved to done.
                    </p>
                    {canEditTasks && (
                      <button
                        onClick={handleUnlinkPr}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                      >
                        Unlink PR
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Link a GitHub PR so Dwight reviews the PR diff (not the latest commit on the default branch) when this task is marked done.
                    </p>
                    {canEditTasks && (
                      <form onSubmit={handleLinkPr} className="flex items-center gap-2">
                        <input
                          type="url"
                          value={prUrlDraft}
                          onChange={(e) => setPrUrlDraft(e.target.value)}
                          placeholder="https://github.com/owner/repo/pull/42"
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                        <button
                          type="submit"
                          disabled={linkingPr || !prUrlDraft.trim()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {linkingPr ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitPullRequest className="w-3 h-3" />}
                          Link
                        </button>
                      </form>
                    )}
                    {prLinkError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400">
                        {prLinkError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Dwight review report — attached to every reviewed task.
                  Shows the verdict, summary, and a compact findings list. */}
              <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                    Dwight review
                  </h3>
                  {latestReview && (
                    <span
                      className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        latestReview.verdict === 'approved'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : latestReview.verdict === 'changes_requested'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                      }`}
                    >
                      {latestReview.verdict === 'approved' && <ShieldCheck className="w-3 h-3" />}
                      {latestReview.verdict === 'changes_requested' && <ShieldAlert className="w-3 h-3" />}
                      {latestReview.verdict === 'comment' && <MessageSquare className="w-3 h-3" />}
                      {latestReview.status === 'pending'
                        ? 'Reviewing'
                        : latestReview.status === 'failed'
                        ? 'Failed'
                        : latestReview.verdict === 'approved'
                        ? 'Approved'
                        : latestReview.verdict === 'changes_requested'
                        ? 'Changes requested'
                        : 'Comment'}
                    </span>
                  )}
                </div>

                {latestReviewLoading && !latestReview && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading review…
                  </div>
                )}

                {!latestReviewLoading && !latestReview && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {editingTask.status === 'under_review'
                      ? 'Dwight is reviewing the latest commit on the default branch. The report will appear here when he finishes.'
                      : 'No Dwight review yet. This task hasn\u2019t been through Dwight\u2019s queue.'}
                  </p>
                )}

                {/* Live activity log — same stream the Dwight tab shows, but
                    inlined here so the user can keep an eye on progress
                    without leaving the board. */}
                {latestReview && latestReview.log && latestReview.log.length > 0 && (
                  <details
                    open={latestReview.status === 'pending'}
                    className="rounded-xl border border-slate-800 bg-slate-950 dark:bg-black/80"
                  >
                    <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] font-mono text-slate-300 select-none list-none">
                      <Terminal className="w-3.5 h-3.5" />
                      <span className="uppercase tracking-wide">Activity</span>
                      {latestReview.status === 'pending' && (
                        <span className="ml-1 inline-flex items-center gap-1 text-rose-400 normal-case">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          live
                        </span>
                      )}
                      <span className="ml-auto text-slate-500 normal-case">
                        {latestReview.log.length} step
                        {latestReview.log.length === 1 ? '' : 's'}
                      </span>
                    </summary>
                    <div className="px-3 pb-3 max-h-48 overflow-y-auto font-mono text-[10.5px] leading-relaxed text-slate-200">
                      {latestReview.log.map((entry, i) => {
                        const t = entry.ts ? new Date(entry.ts) : null;
                        const hh = t ? String(t.getHours()).padStart(2, '0') : '--';
                        const mm = t ? String(t.getMinutes()).padStart(2, '0') : '--';
                        const ss = t ? String(t.getSeconds()).padStart(2, '0') : '--';
                        return (
                          <div key={`${entry.ts}-${i}`} className="flex items-start gap-2 py-0.5">
                            <span className="text-slate-500 select-none">[{hh}:{mm}:{ss}]</span>
                            {entry.status === 'started' ? (
                              <Loader2 className="w-3 h-3 mt-0.5 text-rose-400 animate-spin flex-shrink-0" />
                            ) : entry.status === 'ok' ? (
                              <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
                            ) : entry.status === 'error' ? (
                              <AlertCircle className="w-3 h-3 mt-0.5 text-rose-400 flex-shrink-0" />
                            ) : (
                              <Info className="w-3 h-3 mt-0.5 text-sky-400 flex-shrink-0" />
                            )}
                            <span
                              className={
                                entry.status === 'error'
                                  ? 'text-rose-300'
                                  : entry.status === 'ok'
                                  ? 'text-emerald-300'
                                  : entry.status === 'started'
                                  ? 'text-rose-200'
                                  : 'text-sky-200'
                              }
                            >
                              {entry.step}
                              {typeof entry.duration_ms === 'number' && entry.status === 'ok' && (
                                <span className="text-slate-500"> · {entry.duration_ms}ms</span>
                              )}
                            </span>
                            {entry.detail && (
                              <span className="text-slate-400 break-all">— {entry.detail}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {latestReview && latestReview.status === 'failed' && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Dwight failed to review.</p>
                      {latestReview.error_message && (
                        <p className="mt-0.5 font-mono opacity-80">{latestReview.error_message}</p>
                      )}
                    </div>
                  </div>
                )}

                {latestReview && latestReview.status === 'completed' && (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {latestReview.summary}
                    </p>

                    {(latestReview.commit_short_sha || latestReview.branch || latestReview.pr_number) && (
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                        {latestReview.commit_short_sha && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitCommit className="w-3 h-3" />
                            {latestReview.commit_short_sha}
                          </span>
                        )}
                        {latestReview.pr_number && (
                          latestReview.pr_url ? (
                            <a
                              href={latestReview.pr_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-300 hover:underline"
                            >
                              <GitPullRequest className="w-3 h-3" />
                              PR #{latestReview.pr_number}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-mono">
                              <GitPullRequest className="w-3 h-3" />
                              PR #{latestReview.pr_number}
                            </span>
                          )
                        )}
                        {latestReview.branch && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitBranch className="w-3 h-3" />
                            {latestReview.branch}
                          </span>
                        )}
                      </div>
                    )}

                    {latestReview.findings.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {latestReview.findings.slice(0, 5).map((f, i) => (
                          <li
                            key={`${f.path}-${i}`}
                            className="p-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="font-mono text-gray-700 dark:text-gray-300 truncate">
                                {f.path}
                              </span>
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  f.severity === 'critical'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                    : f.severity === 'major'
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                                    : f.severity === 'minor'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                }`}
                              >
                                {f.severity}
                              </span>
                            </div>
                            <p className="text-gray-700 dark:text-gray-300">{f.summary}</p>
                          </li>
                        ))}
                        {latestReview.findings.length > 5 && (
                          <li className="text-[10px] text-gray-500 dark:text-gray-400 text-center">
                            +{latestReview.findings.length - 5} more in the Dwight tab
                          </li>
                        )}
                      </ul>
                    )}

                    {latestReview.body_markdown && (
                      <pre className="mt-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                        {latestReview.body_markdown}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action row */}
            <div className="flex gap-3 pt-5 mt-1">
              {canEditTasks && (
                <button
                  type="button"
                  onClick={handleDeleteFromDetail}
                  className="group inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:scale-[1.02] active:scale-95 transition-all duration-300 text-sm font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-12" />
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={closeTaskDetail}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:scale-[1.02] active:scale-95 transition-all duration-300 text-sm font-semibold"
              >
                {canEditTasks ? 'Cancel' : 'Close'}
              </button>
              {canEditTasks && (
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editTitle.trim()}
                  className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-sm"
                >
                  {savingEdit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create GitHub Repo Modal */}
      {showCreateRepoModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onClick={() => setShowCreateRepoModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
              Create GitHub Repository
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This will create a new repo under your GitHub account and link it to this project.
            </p>

            {repoError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-sm">
                {repoError}
              </div>
            )}

            <form onSubmit={handleCreateRepo} className="space-y-4">
              <div>
                <label
                  htmlFor="repo-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Repository Name
                </label>
                <input
                  id="repo-name"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  required
                  placeholder="my-awesome-project"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="repo-description"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Description
                </label>
                <textarea
                  id="repo-description"
                  value={repoDescription}
                  onChange={(e) => setRepoDescription(e.target.value)}
                  rows={2}
                  placeholder="Short description of this project"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="repo-private"
                  type="checkbox"
                  checked={repoPrivate}
                  onChange={(e) => setRepoPrivate(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <label
                  htmlFor="repo-private"
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  Private repository
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateRepoModal(false)
                    setRepoError('')
                  }}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingRepo}
                  className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creatingRepo ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Repo'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GitHub re-auth modal — shown whenever any GitHub-backed action
          (Dwight review, Jim push, create repo, link PR) detects a stale
          token. The primary CTA starts the OAuth round trip; the user
          lands back here automatically and the original action is
          replayed via `consumeRetry()` on the next mount. */}
      <GithubReauthModal
        payload={githubReauth}
        actionLabel={githubReauthAction || 'this action'}
        returnTo={typeof window !== 'undefined' ? window.location.pathname : `/projects/${projectId}`}
        onDismiss={() => setGithubReauth(null)}
      />
    </div>
  )
}
