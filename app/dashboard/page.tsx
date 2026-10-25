import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Users,
  FolderKanban,
  Plus,
  LogOut,
  CheckCircle2,
  Clock,
  AlertCircle,
  Code,
  Crown,
  ArrowRight,
  ListTodo,
  Compass,
  Send,
  CheckCircle,
  XCircle,
  Hourglass,
  Settings,
  Sparkles,
} from 'lucide-react'
import ModeToggle from './ModeToggle'

export default async function DashboardPage() {
  // Read the user-selected view from the cookie. Default to "dev" for new
  // users so they see the Discover CTA and learn the flow before creating
  // teams. The toggle in the header sets this cookie.
  const cookieStore = await cookies()
  const cookieMode = cookieStore.get('dave-view-mode')?.value
  const viewMode: 'dev' | 'owner' = cookieMode === 'owner' ? 'owner' : 'dev'
  const isOwnerView = viewMode === 'owner'

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fetch user's team memberships
  const { data: teamMemberships } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)

  const teamIds = (teamMemberships || []).map((tm) => tm.team_id).filter(Boolean)

  let teams: any[] = []
  if (teamIds.length > 0) {
    const { data: teamsData } = await supabase
      .from('teams')
      .select('*')
      .in('id', teamIds)
      .order('created_at', { ascending: false })

    teams = (teamsData || []).map((t) => ({
      ...t,
      user_role: teamMemberships?.find((tm) => tm.team_id === t.id)?.role || 'dev',
    }))
  }

  // Fetch user's project memberships
  const { data: projectMemberships } = await supabase
    .from('project_members')
    .select('project_id, role')
    .eq('user_id', user.id)

  const directProjectIds = (projectMemberships || [])
    .map((pm) => pm.project_id)
    .filter(Boolean)

  let projects: any[] = []
  if (directProjectIds.length > 0 || teamIds.length > 0) {
    // Include both active and draft (planning) projects. Draft projects are
    // visible to all team members per the new flow, but only the owner can
    // mutate them. We exclude archived / on_hold from the dashboard — those
    // are admin views, not the "what am I working on today" list.
    let projectQuery = supabase
      .from('projects')
      .select('*, teams(name)')
      .in('status', ['active', 'draft'])

    if (directProjectIds.length > 0 && teamIds.length > 0) {
      projectQuery = projectQuery.or(
        `id.in.(${directProjectIds.join(',')}),team_id.in.(${teamIds.join(',')})`
      )
    } else if (directProjectIds.length > 0) {
      projectQuery = projectQuery.in('id', directProjectIds)
    } else if (teamIds.length > 0) {
      projectQuery = projectQuery.in('team_id', teamIds)
    }

    const { data: projectsData } = await projectQuery.order('created_at', { ascending: false })
    projects = projectsData || []
  }

  // Fetch tasks assigned to this developer / user
  const { data: myTasks } = await supabase
    .from('tasks')
    .select('id, title, description, column_id, priority, created_at, assignee_id')
    .eq('assignee_id', user.id)
    .order('created_at', { ascending: false })

  let enrichedTasks: any[] = []
  if (myTasks && myTasks.length > 0) {
    const columnIds = Array.from(new Set(myTasks.map((t) => t.column_id).filter(Boolean)))

    if (columnIds.length > 0) {
      const { data: columnsData } = await supabase
        .from('columns')
        .select('id, name, board_id')
        .in('id', columnIds)

      const boardIds = Array.from(
        new Set((columnsData || []).map((c) => c.board_id).filter(Boolean))
      )

      let boardsMap = new Map()
      let projectsMap = new Map()

      if (boardIds.length > 0) {
        const { data: boardsData } = await supabase
          .from('boards')
          .select('id, name, project_id')
          .in('id', boardIds)

        const pIds = Array.from(
          new Set((boardsData || []).map((b) => b.project_id).filter(Boolean))
        )
        if (pIds.length > 0) {
          const { data: projectsData } = await supabase
            .from('projects')
            .select('id, name')
            .in('id', pIds)

          ;(projectsData || []).forEach((p) => projectsMap.set(p.id, p))
        }

        ;(boardsData || []).forEach((b) => {
          boardsMap.set(b.id, {
            ...b,
            project: projectsMap.get(b.project_id),
          })
        })
      }

      const columnsMap = new Map()
      ;(columnsData || []).forEach((c) => {
        columnsMap.set(c.id, {
          ...c,
          board: boardsMap.get(c.board_id),
        })
      })

      enrichedTasks = myTasks.map((t) => {
        const col = columnsMap.get(t.column_id)
        return {
          ...t,
          column_name: col?.name || 'Backlog',
          project_name: col?.board?.project?.name || 'Epic',
          project_id: col?.board?.project?.id,
        }
      })
    }
  }

  // Fetch the user's join requests (developer discover flow)
  // We only care about recent ones (any status) so the dev can see status at a glance.
  const { data: myJoinRequests } = await supabase
    .from('team_join_requests')
    .select('id, team_id, status, message, created_at, decided_at, teams(name, is_public)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Count of public teams (for the hero card)
  const { count: publicTeamsCount } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('is_public', true)

  const isOwner = isOwnerView

  const handleSignOut = async () => {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  const getPriorityBadge = (priority: string) => {
    // Returns [classes, animatedFlag]. animatedFlag tells the template whether
    // to render the shimmer / pulse glow on top of the colour classes.
    switch (priority) {
      case 'urgent':
        return [
          'bg-gradient-to-r from-red-500 to-rose-500 text-white border-transparent shadow-md shadow-red-500/30',
          true,
        ] as const
      case 'high':
        return [
          'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
          false,
        ] as const
      case 'medium':
        return [
          'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
          false,
        ] as const
      default:
        return [
          'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600',
          false,
        ] as const
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                DAVE
              </h1>
              <ModeToggle initialMode={viewMode} />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400 hidden sm:inline">
                Welcome,{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {profile?.name || user.email}
                </span>
              </span>
              <Link
                href="/settings"
                title="Settings"
                aria-label="Settings"
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors rounded-xl border border-gray-200 dark:border-gray-700 hover:border-purple-200 dark:hover:border-purple-800"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden md:inline">Settings</span>
              </Link>
              <form action={handleSignOut}>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-xl border border-gray-200 dark:border-gray-700 hover:border-red-200 dark:hover:border-red-800"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden md:inline">Sign Out</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Hero — adapts to current view mode when the user has no teams yet */}
        {teams.length === 0 && !isOwnerView && (
          <section>
            <div className="bg-aurora-cool rounded-3xl shadow-2xl shadow-cyan-500/30 p-8 sm:p-12 text-white relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full animate-float-slow" />
              <div className="absolute -right-16 -bottom-16 w-56 h-56 bg-white/5 rounded-full animate-float" />
              <div className="absolute left-1/2 top-1/3 w-72 h-72 bg-white/5 rounded-full blur-3xl animate-float-slow" />
              <div className="relative">
                <div className="inline-flex p-3 bg-white/20 backdrop-blur-sm rounded-2xl mb-4 animate-bounce-soft">
                  <Compass className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-2">
                  Welcome, Developer! 👋
                </h2>
                <p className="text-cyan-50 text-base sm:text-lg mb-6 max-w-2xl">
                  You aren't part of any team yet. Browse public teams and send a
                  join request to start collaborating on Epics.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/teams/discover"
                    className="group inline-flex items-center gap-2 px-6 py-3 bg-white text-cyan-600 hover:text-cyan-700 font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
                  >
                    <Compass className="w-5 h-5 transition-transform duration-300 group-hover:rotate-45" />
                    Discover Teams
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                  <span className="text-sm text-cyan-100">
                    {publicTeamsCount ?? 0} public {publicTeamsCount === 1 ? 'team' : 'teams'} available
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {teams.length === 0 && isOwnerView && (
          <section>
            <div className="bg-aurora rounded-3xl shadow-2xl shadow-purple-500/30 p-8 sm:p-12 text-white relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full animate-float-slow" />
              <div className="absolute -right-16 -bottom-16 w-56 h-56 bg-white/5 rounded-full animate-float" />
              <div className="absolute left-1/3 top-1/2 w-72 h-72 bg-white/5 rounded-full blur-3xl animate-float-slow" />
              <div className="relative">
                <div className="inline-flex p-3 bg-white/20 backdrop-blur-sm rounded-2xl mb-4 animate-bounce-soft">
                  <Crown className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold mb-2">
                  Welcome, Team Owner! 👋
                </h2>
                <p className="text-purple-50 text-base sm:text-lg mb-6 max-w-2xl">
                  Start by creating your first team. You'll then add developers and
                  launch Epics with WIP-aware Kanban boards.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/teams/new"
                    className="group inline-flex items-center gap-2 px-6 py-3 bg-white text-purple-600 hover:text-purple-700 font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
                  >
                    <Plus className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" />
                    Create Your First Team
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                  <span className="text-sm text-purple-100">
                    Tip: toggle to Developer view to discover public teams instead.
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* My Join Requests (developer) */}
        {!isOwner && myJoinRequests && myJoinRequests.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl shadow-md shadow-cyan-500/20 text-white transition-transform duration-300 hover:scale-110 hover:rotate-3">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    My Join Requests
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Track the status of teams you've requested to join
                  </p>
                </div>
              </div>
              <Link
                href="/teams/discover"
                className="group hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-white dark:bg-gray-800 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 rounded-xl shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-300"
              >
                <Compass className="w-4 h-4 transition-transform duration-300 group-hover:rotate-45" />
                Discover more
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {myJoinRequests.map((req: any, idx: number) => {
                const status = req.status as 'pending' | 'approved' | 'rejected' | 'cancelled'
                const statusConfig: Record<string, { label: string; classes: string; icon: any; pulse: boolean }> = {
                  pending: {
                    label: 'Pending',
                    classes: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
                    icon: Hourglass,
                    pulse: true,
                  },
                  approved: {
                    label: 'Approved',
                    classes: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-transparent shadow-md shadow-emerald-500/30',
                    icon: CheckCircle,
                    pulse: false,
                  },
                  rejected: {
                    label: 'Rejected',
                    classes: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
                    icon: XCircle,
                    pulse: false,
                  },
                  cancelled: {
                    label: 'Cancelled',
                    classes: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600',
                    icon: XCircle,
                    pulse: false,
                  },
                }
                const cfg = statusConfig[status] || statusConfig.pending
                const StatusIcon = cfg.icon
                const isApproved = status === 'approved'
                return (
                  <div
                    key={req.id}
                    style={{ ['--i' as any]: idx }}
                    className={`lift bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:shadow-cyan-500/10 transition-[box-shadow,border-color,transform] duration-300 flex flex-col justify-between ${
                      isApproved ? 'hover:border-emerald-300 dark:hover:border-emerald-600' : ''
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800">
                          Team
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.classes} ${
                            cfg.pulse ? 'animate-pulse-glow' : ''
                          }`}
                        >
                          {cfg.pulse && (
                            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-amber-500">
                              <span className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-75" />
                            </span>
                          )}
                          <StatusIcon className={`w-3 h-3 ${isApproved ? 'animate-spin-slow' : ''}`} />
                          {cfg.label}
                        </span>
                      </div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1.5 truncate">
                        {req.teams?.name || 'Unknown team'}
                      </h3>
                      {req.message && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 italic mb-3">
                          "{req.message}"
                        </p>
                      )}
                    </div>
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between mt-2">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {status === 'pending' ? 'Awaiting owner review' : status === 'approved' ? 'You can now collaborate' : status === 'rejected' ? 'Owner declined' : 'You cancelled'}
                      </span>
                      {status === 'approved' && (
                        <Link
                          href={`/teams/${req.team_id}`}
                          className="group inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                        >
                          Open team
                          <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Developer Assigned Issues Section */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-md shadow-emerald-500/20 text-white transition-transform duration-300 hover:scale-110 hover:rotate-3">
                <ListTodo className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  My Assigned Issues ({enrichedTasks.length})
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Tasks and backlog issues assigned directly to you across all Epics
                </p>
              </div>
            </div>
          </div>

          {enrichedTasks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {enrichedTasks.map((task, idx) => {
                const [priorityClasses, isUrgentPriority] = getPriorityBadge(task.priority)
                return (
                <div
                  key={task.id}
                  style={{ ['--i' as any]: idx }}
                  className="lift ring-aurora bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-2xl hover:shadow-emerald-500/20 transition-[box-shadow,border-color] duration-300 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        {task.column_name}
                      </span>
                      <span
                        className={`relative text-[11px] font-bold px-2 py-0.5 rounded-md border capitalize ${priorityClasses} ${
                          isUrgentPriority ? 'animate-pulse-glow' : ''
                        }`}
                      >
                        <span className={isUrgentPriority ? 'text-shimmer' : ''}>
                          {task.priority || 'medium'}
                        </span>
                      </span>
                    </div>

                    <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1.5 line-clamp-2">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                        {task.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between mt-2">
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium truncate max-w-[150px]">
                      Epic: {task.project_name}
                    </span>
                    {task.project_id && (
                      <Link
                        href={`/projects/${task.project_id}`}
                        className="group inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                      >
                        View Board
                        <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                      </Link>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-8 text-center border border-gray-200 dark:border-gray-700 animate-fade-in">
              <div className="inline-flex p-3.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl mb-3 text-emerald-600 dark:text-emerald-400 animate-bounce-soft">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                No open issues assigned to you
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                {isOwner
                  ? 'Assign tasks to yourself or team members inside your Epic Kanban boards to track active progress.'
                  : 'You have no assigned tasks right now. Once your Team Owner assigns issues in an Epic, they will appear here!'}
              </p>
            </div>
          )}
        </section>

        {/* Epics / Projects Section */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl shadow-md shadow-blue-500/20 text-white transition-transform duration-300 hover:scale-110 hover:rotate-3">
                <FolderKanban className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Epics & Projects
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Active boards plus any projects still in Planning
                </p>
              </div>
            </div>
            {isOwner && teams && teams.length > 0 && (
              <div className="flex items-center gap-2">
                <Link
                  href="/projects/from-hackathon"
                  className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                >
                  <Sparkles className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                  From Hackathon
                </Link>
                <Link
                  href="/projects/new"
                  className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                >
                  <Plus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                  New Epic
                </Link>
              </div>
            )}
          </div>

          {projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
              {projects.map((project, idx) => {
                const isDraft = project.status === 'draft'
                const deadlineDate = project.deadline ? new Date(project.deadline) : null
                // Server component: "now" is constant for the lifetime of this
                // response, so reading it during render is safe and gives the
                // user a stable "due in 5d" snapshot.
                // eslint-disable-next-line react-hooks/purity
                const daysUntil = deadlineDate
                  ? Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null
                const isOverdue = daysUntil !== null && daysUntil < 0
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    style={{ ['--i' as any]: idx }}
                    className={`lift-strong ring-aurora group bg-white dark:bg-gray-800 rounded-2xl p-6 border hover:shadow-2xl transition-[box-shadow,border-color] duration-300 flex flex-col justify-between ${
                      isDraft
                        ? 'border-amber-200 dark:border-amber-800/60 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-amber-500/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-blue-500/30'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between mb-3 gap-2">
                        <div className={`p-3 rounded-xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 ${
                          isDraft
                            ? 'bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30'
                            : 'bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30'
                        }`}>
                          <FolderKanban className={`w-6 h-6 ${
                            isDraft
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-blue-600 dark:text-blue-400'
                          }`} />
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                            isDraft
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
                          }`}>
                            {project.teams?.name || 'Active Epic'}
                          </span>
                          {isDraft && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-amber-500">
                                <span className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-75" />
                              </span>
                              Planning
                            </span>
                          )}
                        </div>
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                          {project.description}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span className={`font-medium ${
                        isOverdue ? 'text-red-600 dark:text-red-400 animate-blink' : ''
                      }`}>
                        {deadlineDate
                          ? isOverdue
                            ? `Overdue ${Math.abs(daysUntil!)}d`
                            : daysUntil === 0
                            ? 'Due today'
                            : `Due in ${daysUntil}d`
                          : isDraft
                          ? 'No deadline set'
                          : 'Capacity: ' + (project.max_open_tasks || 5) + ' WIP Max'}
                      </span>
                      <span className={`font-semibold flex items-center gap-1 ${
                        isDraft
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}>
                        {isDraft ? 'Plan' : 'Open Kanban'}{' '}
                        <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 text-center border border-gray-200 dark:border-gray-700 animate-fade-in">
              <div className="inline-flex p-4 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-2xl mb-3 animate-float">
                <FolderKanban className="w-10 h-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                No Epics yet
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-5 max-w-md mx-auto">
                {isOwner
                  ? 'Create an Epic to plan tasks, set a deadline, and assign work to your team before going live.'
                  : 'Your team owner has not added you to any active or planning Epics yet.'}
              </p>
              {isOwner && teams && teams.length > 0 && (
                <div className="flex items-center gap-2 justify-center">
                  <Link
                    href="/projects/from-hackathon"
                    className="group inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                  >
                    <Sparkles className="w-4 h-4 transition-transform duration-300 group-hover:rotate-12" />
                    From Hackathon
                  </Link>
                  <Link
                    href="/projects/new"
                    className="group inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                  >
                    <Plus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                    Create Your First Epic
                  </Link>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Teams Section */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-md shadow-purple-500/20 text-white transition-transform duration-300 hover:scale-110 hover:rotate-3">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Your Teams
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Engineering groups and cross-functional teams
                </p>
              </div>
            </div>
            {isOwner && (
              <Link
                href="/teams/new"
                className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
              >
                <Plus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                New Team
              </Link>
            )}
          </div>

          {teams && teams.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
              {teams.map((team, idx) => (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}`}
                  style={{ ['--i' as any]: idx }}
                  className="lift-strong ring-aurora group bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 hover:shadow-2xl hover:shadow-purple-500/30 transition-[box-shadow,border-color] duration-300 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-3 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                        <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full capitalize">
                        {team.user_role}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors duration-300">
                      {team.name}
                    </h3>
                    {team.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                        {team.description}
                      </p>
                    )}
                  </div>
                  <div className="pt-3 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-end text-xs font-semibold text-purple-600 dark:text-purple-400">
                    Manage Team{' '}
                    <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 text-center border border-gray-200 dark:border-gray-700 animate-fade-in">
              <div className="inline-flex p-4 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-2xl mb-3 animate-float">
                <Users className="w-10 h-10 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                No teams joined yet
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-5 max-w-md mx-auto">
                {isOwner
                  ? 'Create your first team to start inviting developers and organizing projects.'
                  : 'Browse public teams on the Discover page and send a request to join one.'}
              </p>
              {isOwner ? (
                <Link
                  href="/teams/new"
                  className="group inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                >
                  <Plus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                  Create Your First Team
                </Link>
              ) : (
                <Link
                  href="/teams/discover"
                  className="group inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/30 hover:shadow-xl hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                >
                  <Compass className="w-4 h-4 transition-transform duration-300 group-hover:rotate-45" />
                  Discover Teams
                </Link>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
