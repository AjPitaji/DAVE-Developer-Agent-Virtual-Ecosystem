'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Loader2,
  Search,
  Globe,
  Users,
  Sparkles,
  Send,
  Check,
  Clock,
  X,
  Crown,
  Compass,
} from 'lucide-react'

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'none'

interface PublicTeam {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_at: string
  member_count: number
  project_count: number
  owner_name: string | null
  request_status: RequestStatus
  request_id: string | null
}

export default function DiscoverTeamsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [teams, setTeams] = useState<PublicTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null)
  const [messageTeamId, setMessageTeamId] = useState<string | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  /**
   * What the current user has shared about their own work. Null when they
   * have not declared a specialization. Used to nudge (never block) the
   * developer before they send a join request.
   */
  const [mySpecialization, setMySpecialization] = useState<string | null>(null)

  const loadTeams = async () => {
    try {
      setLoading(true)
      setError('')

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // Single security-definer RPC. Doing this as separate client queries
      // required RLS policies that let team_members depend on teams, which
      // chained back into team_members and threw error 42P17.
      const { data, error: rpcError } = await supabase.rpc('discover_teams')

      if (rpcError) throw rpcError

      const enriched: PublicTeam[] = ((data || []) as any[]).map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        owner_id: row.owner_id,
        created_at: row.created_at,
        member_count: Number(row.member_count || 0),
        project_count: Number(row.project_count || 0),
        owner_name: row.owner_name,
        request_status: (row.request_status || 'none') as RequestStatus,
        request_id: row.request_id || null,
      }))

      setTeams(enriched)
    } catch (err: any) {
      setError(err.message || 'Failed to load public teams')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Load whatever the current user has shared about their own work so the
   * join-request modal can tell them what the team owner will see. Sharing is
   * entirely optional — this only drives a nudge.
   */
  useEffect(() => {
    const loadOwnSpecialization = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('specialization')
        .eq('id', user.id)
        .maybeSingle()

      setMySpecialization(data?.specialization?.trim() || null)
    }

    loadOwnSpecialization()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false) ||
        (t.owner_name?.toLowerCase().includes(q) ?? false)
    )
  }, [teams, search])

  const openRequestModal = (teamId: string) => {
    setMessageTeamId(teamId)
    setRequestMessage('')
    setError('')
    setSuccessMsg('')
  }

  const cancelRequestModal = () => {
    setMessageTeamId(null)
    setRequestMessage('')
  }

  const sendJoinRequest = async () => {
    if (!messageTeamId) return
    setBusyTeamId(messageTeamId)
    setError('')
    setSuccessMsg('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Make sure user isn't already a member
      const { data: existingMember } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', messageTeamId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingMember) {
        throw new Error('You are already a member of this team.')
      }

      const trimmed = requestMessage.trim()
      const { error: insertError } = await supabase.from('team_join_requests').insert({
        team_id: messageTeamId,
        user_id: user.id,
        status: 'pending',
        message: trimmed.length > 0 ? trimmed : null,
      })

      if (insertError) {
        // Unique partial index hit = already have a pending request
        if (insertError.code === '23505') {
          throw new Error('You already have a pending request for this team.')
        }
        throw insertError
      }

      setSuccessMsg('Join request sent! The team owner will review it shortly.')
      setMessageTeamId(null)
      setRequestMessage('')
      await loadTeams()
    } catch (err: any) {
      setError(err.message || 'Failed to send request')
    } finally {
      setBusyTeamId(null)
    }
  }

  const cancelPendingRequest = async (requestId: string, teamId: string) => {
    if (!confirm('Cancel this join request?')) return
    setBusyTeamId(teamId)
    setError('')
    setSuccessMsg('')

    try {
      const { error: rpcError } = await supabase.rpc('cancel_join_request', {
        p_request_id: requestId,
      })

      if (rpcError) throw rpcError

      setSuccessMsg('Request cancelled.')
      await loadTeams()
    } catch (err: any) {
      setError(err.message || 'Failed to cancel request')
    } finally {
      setBusyTeamId(null)
    }
  }

  const requestAgain = async (teamId: string) => {
    setBusyTeamId(teamId)
    setError('')
    setSuccessMsg('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error: insertError } = await supabase.from('team_join_requests').insert({
        team_id: teamId,
        user_id: user.id,
        status: 'pending',
        message: null,
      })

      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error('You already have a pending request for this team.')
        }
        throw insertError
      }

      setSuccessMsg('Join request re-sent!')
      await loadTeams()
    } catch (err: any) {
      setError(err.message || 'Failed to send request')
    } finally {
      setBusyTeamId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-5xl mx-auto pt-6 pb-16">
        {/* Back Link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl mb-4 shadow-lg shadow-cyan-500/50">
            <Compass className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Discover Teams
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            Browse teams that are open to new developers. Send a join request and
            the team owner will review it.
          </p>
        </div>

        {/* Search Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 border border-gray-100 dark:border-gray-700 mb-6">
          <div className="relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by team name, description, or owner…"
              className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all"
            />
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl flex items-center gap-2 text-sm">
            <X className="w-4 h-4" />
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-emerald-500" />
            {successMsg}
          </div>
        )}

        {/* Request Message Modal */}
        {messageTeamId && (
          <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 max-w-md w-full border border-gray-100 dark:border-gray-700">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Send className="w-5 h-5 text-cyan-600" />
                    Send join request
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Add a short note so the owner knows why you&apos;d like to join.
                  </p>
                </div>
                <button
                  onClick={cancelRequestModal}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <textarea
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Hi! I&apos;d love to contribute to your team because…"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all resize-none text-sm"
              />
              {/* Optional nudge — never blocks sending the request. */}
              <div className="mt-3 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800/60">
                {mySpecialization ? (
                  <p className="text-xs text-cyan-800 dark:text-cyan-200 flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>
                      The owner will see{' '}
                      <span className="font-semibold">{mySpecialization}</span> alongside
                      your request.
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-cyan-800 dark:text-cyan-200 flex items-start gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>
                      The owner reviews who they bring on, so sharing what you work
                      on helps your request stand out.{' '}
                      <Link
                        href="/settings"
                        className="font-semibold underline underline-offset-2 hover:no-underline"
                      >
                        Add your specialization
                      </Link>{' '}
                      — optional, you can send the request now.
                    </span>
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={cancelRequestModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendJoinRequest}
                  disabled={busyTeamId === messageTeamId}
                  className="px-5 py-2 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busyTeamId === messageTeamId ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send request
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Teams Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-cyan-600 animate-spin" />
          </div>
        ) : filteredTeams.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 text-center border border-gray-200 dark:border-gray-700">
            <div className="inline-flex p-4 bg-gradient-to-br from-cyan-100 to-blue-100 dark:from-cyan-900/30 dark:to-blue-900/30 rounded-2xl mb-3">
              <Globe className="w-10 h-10 text-cyan-600 dark:text-cyan-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              {search.trim() ? 'No teams match your search' : 'No discoverable teams yet'}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto">
              {search.trim()
                ? 'Try a different keyword, or clear the search to see all public teams.'
                : 'When team owners mark their team as public, it will appear here for developers to browse.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredTeams.map((team) => {
              const isBusy = busyTeamId === team.id
              return (
                <div
                  key={team.id}
                  className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 hover:border-cyan-300 dark:hover:border-cyan-600 hover:shadow-xl hover:shadow-cyan-500/10 transition-all flex flex-col"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-3 bg-gradient-to-br from-cyan-100 to-blue-100 dark:from-cyan-900/30 dark:to-blue-900/30 rounded-xl">
                      <Users className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <Globe className="w-3 h-3" />
                      Public
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
                    {team.name}
                  </h3>

                  {team.owner_name && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-purple-500" />
                      Led by <span className="font-semibold">{team.owner_name}</span>
                    </p>
                  )}

                  {team.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-3">
                      {team.description}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400 mb-4">
                    <span className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 px-2.5 py-1 rounded-full">
                      <Users className="w-3.5 h-3.5" />
                      {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
                    </span>
                    <span className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 px-2.5 py-1 rounded-full">
                      <Sparkles className="w-3.5 h-3.5" />
                      {team.project_count} {team.project_count === 1 ? 'project' : 'projects'}
                    </span>
                  </div>

                  {/* Action Button */}
                  <div className="mt-auto pt-3 border-t border-gray-100 dark:border-gray-700/60">
                    {team.request_status === 'pending' ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-full">
                          <Clock className="w-3.5 h-3.5" />
                          Request pending
                        </span>
                        <button
                          onClick={() => team.request_id && cancelPendingRequest(team.request_id, team.id)}
                          disabled={isBusy}
                          className="text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : team.request_status === 'rejected' ? (
                      <button
                        onClick={() => requestAgain(team.id)}
                        disabled={isBusy}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Request again
                          </>
                        )}
                      </button>
                    ) : team.request_status === 'approved' ? (
                      <div className="text-center text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-xl">
                        ✓ Approved — visit your dashboard
                      </div>
                    ) : (
                      <button
                        onClick={() => openRequestModal(team.id)}
                        disabled={isBusy}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-xl shadow-md shadow-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="w-4 h-4" />
                        Request to join
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}