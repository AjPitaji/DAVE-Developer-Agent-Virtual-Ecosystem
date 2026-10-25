'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/utils/error'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FolderKanban,
  Lightbulb,
  Loader2,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { ChallengeBrief } from '@/components/hackathon/ChallengeBrief'
import { IdeaPicker } from '@/components/hackathon/IdeaPicker'
import { ConsultantChat } from '@/components/hackathon/ConsultantChat'
import type { HackathonInfo } from '@/lib/types/hackathon'
import type { ConsultantDraft, ConsultantMessage, ProjectIdea } from '@/lib/types/idea'

interface Team {
  id: string
  name: string
}

type Step = 'scrape' | 'ideate' | 'consult' | 'review'

const WIZARD_STEPS: { id: Step; label: string; icon: typeof Sparkles }[] = [
  { id: 'scrape', label: 'Challenge', icon: Sparkles },
  { id: 'ideate', label: 'Ideas', icon: Lightbulb },
  { id: 'consult', label: 'Consult', icon: MessageSquare },
  { id: 'review', label: 'Set up', icon: FolderKanban },
]

const CONSULTANT_GREETING =
  "Let's turn this into something you can actually demo. Tell me what to change — who it's for, what the core flow is, anything you want cut or added."

function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default function FromHackathonPage() {
  const router = useRouter()
  const supabase = createClient()

  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')

  const [hackathonUrl, setHackathonUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState('')
  const [hackathon, setHackathon] = useState<HackathonInfo | null>(null)

  const [ideas, setIdeas] = useState<ProjectIdea[]>([])
  const [ideasLoading, setIdeasLoading] = useState(false)
  const [ideasError, setIdeasError] = useState('')
  const [ownIdea, setOwnIdea] = useState('')

  const [draft, setDraft] = useState<ConsultantDraft>({
    name: '',
    description: '',
    techStack: [],
  })
  const [messages, setMessages] = useState<ConsultantMessage[]>([])
  const [consulting, setConsulting] = useState(false)
  const [consultError, setConsultError] = useState('')

  const [deadline, setDeadline] = useState('')
  const [maxOpenTasks, setMaxOpenTasks] = useState(10)

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [step, setStep] = useState<Step>('scrape')

  // Load teams on mount
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // The projects insert policy (projects_insert_team_owners) only lets a
      // team OWNER create a project, so offer just the teams the user owns.
      // Offering joined teams would fail at insert time with an RLS error.
      const { data: memberships } = await supabase
        .from('team_members')
        .select('team_id, role')
        .eq('user_id', user.id)
        .eq('role', 'owner')

      const ownedTeamIds = new Set(
        (memberships || []).map((m: { team_id: string }) => m.team_id)
      )

      const { data } = await supabase
        .from('teams')
        .select('id, name')
        .order('name')
      const owned = (data || []).filter((t: { id: string }) => ownedTeamIds.has(t.id))
      setTeams(owned)
      if (owned.length) setSelectedTeamId(owned[0].id)
    })()
  }, [])

  const loadIdeas = useCallback(
    async (brief?: HackathonInfo | null) => {
      const target = brief ?? hackathon
      if (!target) return
      setIdeasLoading(true)
      setIdeasError('')
      try {
        const res = await fetch('/api/hackathon/ideas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief: target }),
        })
        const data = await res.json()
        if (!res.ok || data.error) throw new Error(data.error || 'Could not generate ideas')
        setIdeas(data.ideas || [])
      } catch (err: unknown) {
        setIdeasError(err instanceof Error ? err.message : 'Could not generate ideas')
      } finally {
        setIdeasLoading(false)
      }
    },
    [hackathon]
  )

  async function handleScrape() {
    setScraping(true)
    setScrapeError('')
    setHackathon(null)
    try {
      const res = await fetch('/api/hackathon/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: hackathonUrl.trim() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Scrape failed')
      const parsed: HackathonInfo = {
        title: data.title || 'Hackathon Project',
        description: data.description || '',
        theme: data.theme || '',
        tags: data.tags || [],
        technologies: data.technologies || [],
        deadline: data.deadline || null,
        url: hackathonUrl.trim(),
        sections: data.sections || [],
      }
      setHackathon(parsed)
      setDeadline(toDateInputValue(parsed.deadline))
      setStep('ideate')
      // Ideas depend on the freshly scraped brief, so fetch them right away.
      void loadIdeas(parsed)
    } catch (err: unknown) {
      setScrapeError(err instanceof Error ? err.message : 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }

  function handleSelectIdea(idea: ProjectIdea) {
    setDraft({
      name: idea.name,
      description: idea.description,
      techStack: idea.techStack.length ? idea.techStack : hackathon?.technologies || [],
    })
    setMessages([{ role: 'assistant', content: CONSULTANT_GREETING }])
    setConsultError('')
    setStep('consult')
  }

  async function handleUseOwnIdea() {
    const text = ownIdea.trim()
    if (!text) return
    const nextDraft: ConsultantDraft = {
      name: '',
      description: text,
      techStack: hackathon?.technologies || [],
    }
    setDraft(nextDraft)
    setMessages([{ role: 'assistant', content: CONSULTANT_GREETING }])
    setConsultError('')
    setStep('consult')
    await sendConsultMessage(`My idea: ${text}`, nextDraft)
  }

  async function sendConsultMessage(message: string, currentDraft?: ConsultantDraft) {
    if (!message.trim() || !hackathon) return
    const baseDraft = currentDraft ?? draft
    setConsulting(true)
    setConsultError('')
    setMessages((prev) => [...prev, { role: 'user', content: message }])
    try {
      const res = await fetch('/api/hackathon/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: hackathon,
          draft: baseDraft,
          message,
          history: messages,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'The consultant could not respond')
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply || 'Here is the updated draft.' },
      ])
      setDraft({
        name: data.name ?? baseDraft.name,
        description: data.description ?? baseDraft.description,
        techStack: Array.isArray(data.techStack) && data.techStack.length
          ? data.techStack
          : baseDraft.techStack,
      })
    } catch (err: unknown) {
      setConsultError(
        err instanceof Error ? err.message : 'The consultant could not respond'
      )
    } finally {
      setConsulting(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      if (!selectedTeamId) throw new Error('Please select a team')
      if (!draft.name.trim()) throw new Error('Project name is required')

      const deadlineIso = deadline ? new Date(`${deadline}T23:59:59`).toISOString() : null

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          team_id: selectedTeamId,
          name: draft.name.trim(),
          description: draft.description.trim() || hackathon?.description || null,
          owner_id: user.id,
          max_open_tasks: maxOpenTasks,
          status: 'draft',
          repo_url: null,
          deadline: deadlineIso,
        })
        .select()
        .single()

      if (projectError) throw projectError

      await supabase.from('boards').insert({
        project_id: project.id,
        name: 'Sprint Board',
        type: 'kanban',
      })

      router.push(`/projects/${project.id}`)
      router.refresh()
    } catch (err: unknown) {
      setCreateError(errorMessage(err, 'Failed to create project'))
    } finally {
      setCreating(false)
    }
  }

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step)

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-4xl mx-auto pt-8 pb-16">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl mb-4 shadow-lg shadow-violet-500/50">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Create Project from Hackathon
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            We read the challenge, shortlist what you could build, and help you shape it
            into a plan your team can start on.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
          {WIZARD_STEPS.map((wizardStep, index) => {
            const Icon = wizardStep.icon
            const isCurrent = step === wizardStep.id
            const isDone = index < stepIndex
            return (
              <div key={wizardStep.id} className="flex items-center gap-2">
                {index > 0 && <ChevronRight className="w-4 h-4 text-gray-400" />}
                <div
                  className={`${
                    isCurrent
                      ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                      : isDone
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  } inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all`}
                >
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  {index + 1}. {wizardStep.label}
                </div>
              </div>
            )
          })}
        </div>

        {step === 'scrape' && (
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700">
            <div className="space-y-4">
              <div>
                <label htmlFor="hackathon-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  DevPost Hackathon URL
                </label>
                <input
                  id="hackathon-url"
                  type="url"
                  value={hackathonUrl}
                  onChange={(e) => setHackathonUrl(e.target.value)}
                  placeholder="https://devpost.com/hackathons/your-hackathon"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  We pull the challenge brief, requirements, submission checklist, technologies
                  and deadline straight from the page.
                </p>
              </div>

              {scrapeError && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {scrapeError}
                </div>
              )}

              <button
                onClick={handleScrape}
                disabled={scraping || !hackathonUrl.trim()}
                className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-semibold py-3.5 px-6 rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {scraping ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Scraping hackathon page…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Scrape &amp; Extract Details
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === 'ideate' && hackathon && (
          <div className="space-y-6">
            <ChallengeBrief hackathon={hackathon} />

            <IdeaPicker
              ideas={ideas}
              loading={ideasLoading}
              error={ideasError}
              onRetry={() => void loadIdeas()}
              onSelect={handleSelectIdea}
              ownIdea={ownIdea}
              onOwnIdeaChange={setOwnIdea}
              onUseOwnIdea={handleUseOwnIdea}
            />

            <div className="flex justify-center">
              <button
                onClick={() => setStep('scrape')}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Use a different hackathon
              </button>
            </div>
          </div>
        )}

        {step === 'consult' && hackathon && (
          <div className="space-y-6">
            <ChallengeBrief hackathon={hackathon} defaultExpanded={[]} />

            <ConsultantChat
              messages={messages}
              draft={draft}
              loading={consulting}
              error={consultError}
              onSend={sendConsultMessage}
              onDraftChange={setDraft}
              onContinue={() => setStep('review')}
              canContinue={Boolean(draft.name.trim())}
            />

            <div className="flex justify-center">
              <button
                onClick={() => setStep('ideate')}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to ideas
              </button>
            </div>
          </div>
        )}

        {step === 'review' && hackathon && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Set up your project
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Tech stack and deadline came from the challenge — adjust anything that
                    does not fit your team.
                  </p>
                </div>
                {hackathon.url && (
                  <a
                    href={hackathon.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline flex-shrink-0"
                  >
                    DevPost <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <form onSubmit={handleCreate} className="space-y-5">
                {createError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                    {createError}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Assign to Team *
                  </label>
                  {teams.length === 0 ? (
                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 text-sm flex items-center justify-between gap-3">
                      <span>
                        You need to own a team to create a project. Create one,
                        or ask an owner to add you.
                      </span>
                      <Link href="/teams/new" className="font-semibold underline whitespace-nowrap">
                        Create Team
                      </Link>
                    </div>
                  ) : (
                    <select
                      value={selectedTeamId}
                      onChange={(e) => setSelectedTeamId(e.target.value)}
                      required
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none"
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Project Name *
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    required
                    placeholder="e.g., AI-Powered Hackathon Buddy"
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      (written with your consultant)
                    </span>
                  </label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    rows={5}
                    placeholder="What your team is building…"
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none resize-none"
                  />
                </div>

                {draft.techStack.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Suggested Stack
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        (a recommendation — change it with the consultant)
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {draft.techStack.map((tech) => (
                        <span
                          key={tech}
                          className="px-2.5 py-1 text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Deadline
                      {hackathon.deadline && (
                        <span className="text-xs font-normal text-gray-400 ml-1">
                          (from DevPost)
                        </span>
                      )}
                    </label>
                    <input
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none"
                    />
                    {hackathon.deadline && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                        Hackathon closes{' '}
                        {new Date(hackathon.deadline).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Max Open Tasks
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={maxOpenTasks}
                      onChange={(e) =>
                        setMaxOpenTasks(
                          Math.min(50, Math.max(1, Number(e.target.value) || 1))
                        )
                      }
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                      How many tasks can be in progress at once.
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creating || teams.length === 0 || !draft.name.trim()}
                  className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-semibold py-3.5 px-6 rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating project…
                    </>
                  ) : (
                    <>
                      <FolderKanban className="w-5 h-5" />
                      Create Project from Hackathon
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => setStep('consult')}
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to the consultation
              </button>
            </div>
          </div>
        )}

        {step !== 'scrape' && (
          <div className="mt-6 flex justify-center gap-4 text-sm">
            <Link href="/projects/new" className="text-violet-600 dark:text-violet-400 hover:underline">
              Or create a project manually
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
