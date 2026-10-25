'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/utils/error'
import { ArrowLeft, Loader2, FolderKanban, Users, Check, Shield, CalendarClock } from 'lucide-react'
import GithubIcon from '@/components/GithubIcon'
import Link from 'next/link'

interface Team {
  id: string
  name: string
  description: string | null
}

interface TeamMember {
  user_id: string
  role: 'owner' | 'dev'
  profiles: {
    id: string
    name: string
    avatar_url: string | null
  }
}

export default function NewProjectPage() {
  const router = useRouter()
  const supabase = createClient()

  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [deadline, setDeadline] = useState('') // yyyy-mm-dd; optional at creation
  const [maxOpenTasks, setMaxOpenTasks] = useState(10)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadTeams() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.push('/login')
          return
        }

        const { data, error } = await supabase
          .from('teams')
          .select('id, name, description')
          .order('name')

        if (error) throw error
        setTeams(data || [])
        if (data && data.length > 0) {
          setSelectedTeamId(data[0].id)
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load teams')
      } finally {
        setLoading(false)
      }
    }

    loadTeams()
  }, [])

  // Load team members when selected team changes
  useEffect(() => {
    if (!selectedTeamId) return

    async function loadMembers() {
      try {
        const { data, error } = await supabase
          .from('team_members')
          .select(`
            user_id,
            role,
            profiles (
              id,
              name,
              avatar_url
            )
          `)
          .eq('team_id', selectedTeamId)

        if (error) throw error
        const validMembers = (data as unknown as TeamMember[]) || []
        setTeamMembers(validMembers)
        // Select all team members by default
        setSelectedMembers(validMembers.map((m) => m.user_id))
      } catch (err: any) {
        console.error('Failed to load team members:', err)
      }
    }

    loadMembers()
  }, [selectedTeamId])

  const toggleMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('Not authenticated')
      if (!selectedTeamId) throw new Error('Please select a team')

      // Accept shorthand like "owner/repo" or "github.com/owner/repo" and
      // normalise to the canonical https://github.com/owner/repo form that the
      // CHECK constraint on projects.repo_url expects.
      let normalizedRepoUrl: string | null = null
      const trimmedRepo = repoUrl.trim()
      if (trimmedRepo) {
        const shorthand = trimmedRepo
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .replace(/^github\.com\//i, '')
          .replace(/\/+$/, '')

        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(shorthand)) {
          throw new Error(
            'Repository must look like owner/repo (e.g. vercel/next.js).'
          )
        }
        normalizedRepoUrl = `https://github.com/${shorthand}`
      }

      // 1. Create Project
      //    Status starts as 'draft' (planning) — the owner assigns tasks to
      //    devs and then clicks "Start Project" on the project page to flip
      //    it to 'active'. Deadline is optional at creation but is required
      //    before the project can be started.
      const deadlineIso = deadline ? new Date(`${deadline}T23:59:59`).toISOString() : null

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          team_id: selectedTeamId,
          name,
          description: description || null,
          owner_id: user.id,
          max_open_tasks: maxOpenTasks,
          status: 'draft',
          repo_url: normalizedRepoUrl,
          deadline: deadlineIso,
        })
        .select()
        .single()

      if (projectError) throw projectError

      // 2. Add extra project members if any selected
      const nonOwnerMembers = selectedMembers.filter((id) => id !== user.id)
      if (nonOwnerMembers.length > 0) {
        const memberInserts = nonOwnerMembers.map((memberId) => ({
          project_id: project.id,
          user_id: memberId,
          role: 'dev' as const,
        }))

        await supabase.from('project_members').insert(memberInserts)
      }

      // 3. Automatically create default Kanban Board for project
      const { error: boardError } = await supabase.from('boards').insert({
        project_id: project.id,
        name: 'Sprint Board',
        type: 'kanban',
      })

      if (boardError) {
        console.warn('Default board creation:', boardError)
      }

      router.push(`/projects/${project.id}`)
      router.refresh()
    } catch (err: any) {
      setError(errorMessage(err, 'Failed to create project'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-3xl mx-auto pt-8 pb-16">
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
          <div className="inline-flex p-4 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl mb-4 shadow-lg shadow-blue-500/50">
            <FolderKanban className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Create a New Project
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Set the deadline, pick your team, then plan tasks before going live
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1.5">
            <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            New projects start in <span className="font-semibold">Planning</span> — they go live
            once every task is assigned and a deadline is set.
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            {/* Team Selection */}
            <div>
              <label
                htmlFor="team"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Assign to Team *
              </label>
              {teams.length === 0 ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 text-sm flex items-center justify-between">
                  <span>You don't have a team yet. Please create one first!</span>
                  <Link
                    href="/teams/new"
                    className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Create Team
                  </Link>
                </div>
              ) : (
                <select
                  id="team"
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Project Name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Project Name *
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g., Q4 Product Launch, Core API v2, Mobile App"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
              />
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Description (Optional)
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief summary of goals and deliverables"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none"
              />
            </div>

            {/* GitHub Repository */}
            <div>
              <label
                htmlFor="repo"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2"
              >
                <GithubIcon className="w-4 h-4 text-gray-700 dark:text-gray-200" />
                GitHub Repository{' '}
                <span className="text-xs font-normal text-gray-400">(Optional)</span>
              </label>
              <input
                id="repo"
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="owner/repository"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Shown as a link on the board so the team always knows where the
                code lives. Agent branches and PRs will attach here.
              </p>
            </div>

            {/* Deadline */}
            <div className="p-4 bg-amber-50/50 dark:bg-amber-900/10 rounded-2xl border border-amber-200 dark:border-amber-900/30">
              <label
                htmlFor="deadline"
                className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-1"
              >
                <CalendarClock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Project Deadline
                <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                  (optional now, required to start)
                </span>
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                You can set this now or add it later. The project stays in{' '}
                <span className="font-semibold">Planning</span> until you
                assign at least one task to every dev and pick a deadline —
                then a single <span className="font-semibold">Start Project</span>{' '}
                button flips it to Active.
              </p>
              <input
                id="deadline"
                type="date"
                value={deadline}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all outline-none"
              />
            </div>

            {/* Capacity Limit (max_open_tasks) */}
            <div className="p-4 bg-purple-50/50 dark:bg-purple-900/10 rounded-2xl border border-purple-200 dark:border-purple-900/30">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="capacity"
                  className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"
                >
                  <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  WIP / Max Open Tasks Capacity
                </label>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/40 px-2.5 py-0.5 rounded-full">
                  {maxOpenTasks} tasks max
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                DAVE prevents burnout by monitoring open task overload and calculating remaining capacity automatically.
              </p>
              <input
                id="capacity"
                type="range"
                min={3}
                max={50}
                value={maxOpenTasks}
                onChange={(e) => setMaxOpenTasks(parseInt(e.target.value, 10))}
                className="w-full accent-purple-600 cursor-pointer"
              />
            </div>

            {/* Team Members Selection */}
            {teamMembers.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  Team Members to Include
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {teamMembers.map((m) => {
                    const isSelected = selectedMembers.includes(m.user_id)
                    return (
                      <div
                        key={m.user_id}
                        onClick={() => toggleMember(m.user_id)}
                        className={`cursor-pointer p-3 rounded-xl border flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600'
                            : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xs">
                            {m.profiles?.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {m.profiles?.name}
                            </p>
                            <p className="text-xs text-gray-500 capitalize">{m.role}</p>
                          </div>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center ${
                            isSelected ? 'bg-blue-600 text-white' : 'border border-gray-400'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || teams.length === 0}
              className="w-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 text-white font-semibold py-3.5 px-6 rounded-xl shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Setting up project & planning board...
                </>
              ) : (
                <>
                  <FolderKanban className="w-5 h-5" />
                  Create Project (Planning Mode)
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
