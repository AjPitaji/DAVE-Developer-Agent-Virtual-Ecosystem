'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Loader2,
  Plus,
  X,
  Crown,
  Code,
  Users,
  Check,
  Mail,
  Globe,
  Globe2,
  Eye,
  EyeOff,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import GithubIcon from '@/components/GithubIcon'
import { SpecializationTags } from '@/components/SpecializationTags'
import Link from 'next/link'
import { use } from 'react'

interface Member {
  user_id: string
  role: 'owner' | 'dev'
  profiles: {
    name: string
    avatar_url: string | null
    email?: string
    role?: string
    github_username?: string | null
    specialization?: string | null
  }
}

interface AvailableProfile {
  id: string
  name: string
  email: string
  role: string
  avatar_url: string | null
  specialization?: string | null
}

interface JoinRequest {
  id: string
  user_id: string
  message: string | null
  created_at: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  profiles: {
    name: string
    email: string
    avatar_url: string | null
    specialization?: string | null
  }
}

/**
 * `pending_join_requests()` returns flat columns (requester_name, ...), not a
 * nested profile object. Map them into the shape the card renders so the
 * requester shows up with a name, avatar and — when they declared one — their
 * specialization.
 */
interface RawJoinRequest {
  id: string
  team_id: string
  user_id: string
  message: string | null
  created_at: string
  status: string
  requester_name: string | null
  requester_email: string | null
  requester_avatar: string | null
  requester_specialization: string | null
}

function toJoinRequest(row: RawJoinRequest): JoinRequest {
  return {
    id: row.id,
    user_id: row.user_id,
    message: row.message,
    created_at: row.created_at,
    status: row.status as JoinRequest['status'],
    profiles: {
      name: row.requester_name || 'Developer',
      email: row.requester_email || '',
      avatar_url: row.requester_avatar,
      specialization: row.requester_specialization,
    },
  }
}

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [team, setTeam] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [availableProfiles, setAvailableProfiles] = useState<AvailableProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddMember, setShowAddMember] = useState(false)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Discover flow state
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isTeamOwner, setIsTeamOwner] = useState(false)
  const [togglingPublic, setTogglingPublic] = useState(false)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const handleLeaveTeam = async () => {
    if (!currentUserId || isTeamOwner) return
    // Check for open tasks assigned to this user across projects in this team
    try {
      const { data: projects } = await supabase
        .from('projects')
        .select('id')
        .eq('team_id', id)
      if (projects && projects.length > 0) {
        const projectIds = projects.map((p: { id: string }) => p.id)
        const { data: boards } = await supabase
          .from('boards')
          .select('id')
          .in('project_id', projectIds)
        if (boards && boards.length > 0) {
          const boardIds = boards.map((b: { id: string }) => b.id)
          const { data: cols } = await supabase
            .from('columns')
            .select('id')
            .in('board_id', boardIds)
          if (cols && cols.length > 0) {
            const colIds = cols.map((c: { id: string }) => c.id)
            const { data: openTasks } = await supabase
              .from('tasks')
              .select('id')
              .in('column_id', colIds)
              .eq('assignee_id', currentUserId)
              .neq('status', 'done')
            if (openTasks && openTasks.length > 0) {
              setError('You have open tasks assigned to you. Complete or reassign them before leaving the team.')
              return
            }
          }
        }
      }
    } catch (err) {
      // If check fails, allow leave anyway
    }
    if (!confirm('Leave this team?')) return
    setLeaving(true)
    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('team_id', id)
        .eq('user_id', currentUserId)
      if (error) throw error
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Failed to leave team')
    } finally {
      setLeaving(false)
    }
  }

  useEffect(() => {
    loadTeamData()
  }, [id])

  const loadTeamData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) setCurrentUserId(user.id)

      // Fetch team details
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('id', id)
        .single()

      if (teamError) throw teamError
      setTeam(teamData)

      // Fetch team members with profile details
      const { data: membersData, error: membersError } = await supabase
        .from('team_members')
        .select(`
          user_id,
          role,
          profiles (
            id,
            name,
            email,
            avatar_url,
            github_username,
            specialization
          )
        `)
        .eq('team_id', id)

      if (membersError) {
        // If RLS blocks reading members, still try to show owner
        const currentMembers: any[] = []
        if (teamData?.owner_id) {
          const { data: ownerProfile } = await supabase
            .from('profiles')
            .select('id, name, email, avatar_url, github_username, specialization')
            .eq('id', teamData.owner_id)
            .maybeSingle()
          currentMembers.unshift({
            user_id: teamData.owner_id,
            role: 'owner',
            profiles: ownerProfile || {
              id: teamData.owner_id,
              name: 'Team Owner',
              email: '',
              avatar_url: null,
            },
          })
        }
        setMembers(currentMembers)
        const isOwnerByCreator = teamData?.owner_id === user?.id
        setIsTeamOwner(Boolean(isOwnerByCreator))
        // Try to load join requests anyway for owner
        if (teamData?.owner_id === user?.id) {
          const { data: requestsData } = await supabase.rpc('pending_join_requests')
          if (requestsData) {
            setJoinRequests(
              (requestsData as unknown as RawJoinRequest[])
                .filter((r) => r.team_id === id)
                .map(toJoinRequest)
            )
          }
        }
      } else {
        const currentMembers = (membersData || []) as any[]

        // Guarantee the team owner is always represented in the members list
        if (teamData?.owner_id) {
          const hasOwner = currentMembers.some((m: any) => m.user_id === teamData.owner_id)
          if (!hasOwner) {
            const { data: ownerProfile } = await supabase
              .from('profiles')
              .select('id, name, email, avatar_url, github_username, specialization')
              .eq('id', teamData.owner_id)
              .maybeSingle()
            currentMembers.unshift({
              user_id: teamData.owner_id,
              role: 'owner',
              profiles: ownerProfile || {
                id: teamData.owner_id,
                name: 'Team Owner',
                email: '',
                avatar_url: null,
              },
            })
          } else {
            const ownerIdx = currentMembers.findIndex((m: any) => m.user_id === teamData.owner_id)
            if (ownerIdx >= 0) currentMembers[ownerIdx].role = 'owner'
          }
        }

        setMembers(currentMembers)

        const isOwnerByCreator = teamData?.owner_id === user?.id
        const ownerEntry = currentMembers.find(
          (m: any) => m.user_id === user?.id && m.role === 'owner'
        )
        setIsTeamOwner(Boolean(ownerEntry) || Boolean(isOwnerByCreator))

        // Fetch available profiles
        const memberIds = currentMembers.map((m: any) => m.user_id)
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url, specialization')

        if (profilesData) {
          setAvailableProfiles(
            (profilesData as { id: string }[]).filter(
              (p: { id: string }) => !memberIds.includes(p.id)
            ) as AvailableProfile[]
          )
        }

        // Fetch pending join requests
        const { data: requestsData, error: requestsError } = await supabase.rpc('pending_join_requests')
        if (!requestsError && requestsData) {
          setJoinRequests(
            (requestsData as unknown as RawJoinRequest[])
              .filter((r) => r.team_id === id)
              .map(toJoinRequest)
          )
        } else {
          setJoinRequests([])
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddMemberById = async (userId: string) => {
    setAddingMember(true)
    setError('')
    setSuccessMsg('')

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .eq('id', userId)
        .single()

      if (profileError || !profile) {
        throw new Error('User not found. Please try again.')
      }

      // Check if already in team
      const alreadyMember = members.some((m) => m.user_id === profile.id)
      if (alreadyMember) {
        throw new Error('This user is already a member of this team.')
      }

      const { error: insertError } = await supabase.from('team_members').insert({
        team_id: id,
        user_id: profile.id,
        role: 'dev',
      })

      if (insertError) throw insertError

      setSuccessMsg(`Added ${profile.name || 'developer'} to the team!`)
      setShowAddMember(false)
      setNewMemberEmail('')
      await loadTeamData()
    } catch (err: any) {
      setError(err.message || 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  const handleAddMemberByEmailForm = async (email: string) => {
    setAddingMember(true)
    setError('')
    setSuccessMsg('')

    try {
      const { data: profile, error: profileError } = await supabase
        .rpc('profile_by_email', { p_email: email.trim().toLowerCase() })
        .single()

      if (profileError || !profile) {
        throw new Error(`No account found for "${email}". Please verify the email address.`)
      }

      // Check if already in team
      const alreadyMember = members.some((m) => m.user_id === profile.id)
      if (alreadyMember) {
        throw new Error('This user is already a member of this team.')
      }

      const { error: insertError } = await supabase.from('team_members').insert({
        team_id: id,
        user_id: profile.id,
        role: 'dev',
      })

      if (insertError) throw insertError

      setSuccessMsg(`Added ${profile.name || email} to the team!`)
      setShowAddMember(false)
      setNewMemberEmail('')
      await loadTeamData()
    } catch (err: any) {
      setError(err.message || 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  const handleTogglePublic = async () => {
    if (!showOwnerControls) return
    setTogglingPublic(true)
    setError('')
    setSuccessMsg('')
    const nextValue = !team?.is_public
    try {
      const { error: updateError } = await supabase
        .from('teams')
        .update({ is_public: nextValue })
        .eq('id', id)
      if (updateError) throw updateError
      setTeam((prev: any) => ({ ...(prev || {}), is_public: nextValue }))
      setSuccessMsg(
        nextValue
          ? 'Team is now discoverable by developers.'
          : 'Team is now hidden from discovery.'
      )
    } catch (err: any) {
      setError(err.message || 'Failed to update visibility')
    } finally {
      setTogglingPublic(false)
    }
  }

  const handleDecideRequest = async (
    requestId: string,
    userId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setDecidingRequestId(requestId)
    setError('')
    setSuccessMsg('')
    try {
      // Single RPC does the ownership check, the team_members insert and the
      // status update. Doing these as separate client calls would require
      // cross-table RLS policies, which is what caused error 42P17.
      const { error: decideError } = await supabase.rpc('decide_join_request', {
        p_request_id: requestId,
        p_decision: decision,
      })

      if (decideError) throw decideError

      setSuccessMsg(
        decision === 'approved'
          ? 'Developer added to the team!'
          : 'Request rejected.'
      )
      await loadTeamData()
    } catch (err: any) {
      setError(err.message || 'Failed to process request')
    } finally {
      setDecidingRequestId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    )
  }

  // Compute ownership inline so the toggle can't hide due to a stale state.
  // We trust EITHER:
  //   1) teams.owner_id === current user  (always set at team creation)
  //   2) team_members.role === 'owner' for the current user
  const showOwnerControls =
    Boolean(isTeamOwner) ||
    (Boolean(team?.owner_id) && team.owner_id === currentUserId)

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-4xl mx-auto pt-8">
        {/* Back Link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        {/* Team Header */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700 mb-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="p-3 bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 rounded-2xl shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white truncate">
                    {team?.name}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      team?.is_public
                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                    }`}
                    title={team?.is_public ? 'Discoverable by developers' : 'Hidden from public discovery'}
                  >
                    {team?.is_public ? (
                      <>
                        <Globe className="w-3 h-3" />
                        Public
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3 h-3" />
                        Private
                      </>
                    )}
                  </span>
                </div>
                {team?.description && (
                  <p className="text-gray-600 dark:text-gray-400 text-sm mt-0.5">{team.description}</p>
                )}
              </div>
            </div>

            {/* Owner-only visibility toggle */}
            {showOwnerControls && (
              <button
                onClick={handleTogglePublic}
                disabled={togglingPublic}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  team?.is_public
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={team?.is_public ? 'Make team private' : 'Make team discoverable'}
              >
                {togglingPublic ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : team?.is_public ? (
                  <Globe2 className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                {team?.is_public ? 'Public' : 'Make public'}
              </button>
            )}
          </div>

            {/* Leave Team button for non-owners */}
            {!showOwnerControls && (
              <button
                onClick={handleLeaveTeam}
                disabled={leaving}
                className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
              >
                {leaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {leaving ? 'Leaving...' : 'Leave Team'}
              </button>
            )}
            {/* Owner helper text */}
            {showOwnerControls && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 px-1">
                {team?.is_public
                  ? '🌐 This team appears in the public Discover page. Developers can send join requests that you approve below.'
                  : 'Make this team public to let developers discover and request to join it.'}
              </p>
            )}
        </div>

        {/* Pending Join Requests (owner only) */}
        {showOwnerControls && (
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700 mb-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-6 h-6 text-amber-500" />
                  Pending Join Requests
                  <span className="text-sm font-normal text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                    {joinRequests.length}
                  </span>
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Developers who want to join this team
                </p>
              </div>
            </div>

            {joinRequests.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2" />
                <p className="text-sm font-medium">All caught up!</p>
                <p className="text-xs">No pending join requests at the moment.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {joinRequests.map((req) => {
                  const isDeciding = decidingRequestId === req.id
                  return (
                    <div
                      key={req.id}
                      className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 rounded-2xl border border-amber-200 dark:border-amber-800/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-white font-bold shadow-md shrink-0">
                            {req.profiles?.name?.charAt(0).toUpperCase() || 'D'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-gray-900 dark:text-white truncate">
                                {req.profiles?.name || 'Developer'}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                <Clock className="w-2.5 h-2.5" />
                                Pending
                              </span>
                            </div>
                            {req.profiles?.email && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
                                {req.profiles.email}
                              </p>
                            )}
                            <SpecializationTags
                              specialization={req.profiles?.specialization}
                              showEmptyHint
                              className="mt-1.5"
                            />
{req.message && (
                              <p className="text-xs text-gray-700 dark:text-gray-300 mt-2 italic bg-white dark:bg-gray-800/60 rounded-lg p-2 border border-amber-100 dark:border-amber-900/40">
                                &ldquo;{req.message}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          <button
                            onClick={() => handleDecideRequest(req.id, req.user_id, 'approved')}
                            disabled={isDeciding}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isDeciding ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            Approve
                          </button>
                          <button
                            onClick={() => handleDecideRequest(req.id, req.user_id, 'rejected')}
                            disabled={isDeciding}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:hover:bg-red-900/30 dark:hover:text-red-300 dark:hover:border-red-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Team Members */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Team Members ({members.length})
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Developers and leads collaborating in this team
              </p>
            </div>
            <button
              onClick={() => {
                setShowAddMember(!showAddMember)
                setError('')
                setSuccessMsg('')
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all"
            >
              <Plus className="w-5 h-5" />
              Add Developer
            </button>
          </div>

          {successMsg && (
            <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              {successMsg}
            </div>
          )}

          {/* Add Member Drawer / Form */}
          {showAddMember && (
            <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-2xl border-2 border-purple-200 dark:border-purple-800 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Add Team Member
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Invite by registered email or choose from available developers
                  </p>
                </div>
                <button
                  onClick={() => setShowAddMember(false)}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Email Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (newMemberEmail.trim()) {
                    handleAddMemberByEmailForm(newMemberEmail)
                  }
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    User Email Address
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        required
                        placeholder="developer@example.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={addingMember || !newMemberEmail.trim()}
                      className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm whitespace-nowrap"
                    >
                      {addingMember ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Add Member
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-2.5 rounded-xl text-sm">
                    {error}
                  </div>
                )}
              </form>

              {/* Quick-Pick Available Profiles */}
              {availableProfiles.length > 0 && (
                <div className="pt-3 border-t border-purple-200 dark:border-purple-800/50">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-2">
                    Registered Users Ready to Add
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {availableProfiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 rounded-xl border border-purple-100 dark:border-gray-700 shadow-sm hover:border-purple-300 transition-all"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                            {profile.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                              {profile.name || 'Developer'}
                            </p>
                            {profile.specialization ? (
                              <SpecializationTags
                                specialization={profile.specialization}
                                variant="inline"
                                className="max-w-full"
                              />
                            ) : (
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {profile.email || 'No specialization shared yet'}
                              </p>
                            )}
                           </div>
                         </div>
<button
                          type="button"
                          onClick={() => handleAddMemberById(profile.id)}
                          disabled={addingMember}
                          className="px-2.5 py-1 text-xs font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-lg transition-colors shrink-0 ml-2"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div className="space-y-3">
            {members.length === 0 ? (
              <div className="text-center py-10 text-gray-500 dark:text-gray-400">
                <Users className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p>No members in this team yet. Invite developers to collaborate!</p>
              </div>
            ) : (
              members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-200 dark:border-gray-600 hover:border-purple-200 dark:hover:border-purple-800 transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-md shadow-purple-500/20">
                      {member.profiles?.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white text-base">
                          {member.profiles?.name || 'Developer'}
                        </span>
                        {member.role === 'owner' ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium">
                            <Crown className="w-3.5 h-3.5 text-purple-500" />
                            Lead
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">
                            <Code className="w-3.5 h-3.5 text-emerald-500" />
                            Developer
                          </span>
                        )}
                      </div>
                      {member.profiles?.email && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {member.profiles.email}
                        </span>
                      )}
                      {member.profiles?.github_username && (
                        <a
                          href={`https://github.com/${member.profiles.github_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          <GithubIcon className="w-3.5 h-3.5" />
                          @{member.profiles.github_username}
                        </a>
                      )}
                      <SpecializationTags
                        specialization={member.profiles?.specialization}
                        showEmptyHint
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                  <div className="text-xs font-semibold px-3 py-1 rounded-xl bg-gray-200/70 dark:bg-gray-600 text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    {member.role === 'owner' ? 'Team Owner' : 'Member'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
