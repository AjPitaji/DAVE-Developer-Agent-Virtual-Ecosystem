'use client'

import { useCallback, useEffect, useState } from 'react'
import { GithubReauthModal } from '@/components/GithubReauthModal'
import { extractGithubReauth, GithubReauthPayload } from '@/lib/github/client'
import {
  GitCommit,
  Loader2,
  AlertCircle,
  Users,
  Calendar,
  TrendingUp,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'

interface Commit {
  sha: string
  shortSha: string
  message: string
  fullMessage: string
  author: string
  avatarUrl: string | null
  date: string | null
  url: string | null
}

interface Summary {
  total: number
  authors: number
  authorNames: string[]
  firstCommitDate: string | null
  lastCommitDate: string | null
  recentCount: number
  hasMore: boolean
}

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

export default function CommitHistorySection({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [reauthPayload, setReauthPayload] = useState<GithubReauthPayload | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/commits`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        const reauth = extractGithubReauth(data)
        if (reauth) setReauthPayload(reauth)
        setError(data?.error || `Failed to load commits (${res.status})`)
        return
      }
      setCommits(data.commits || [])
      setSummary(data.summary || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commits')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-purple-500" />
          Commit history
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
`
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading commits…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <GitCommit className="w-3.5 h-3.5" />
                Total commits
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                {summary.total}
                {summary.hasMore && <span className="text-xs font-normal text-gray-400">+</span>}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Users className="w-3.5 h-3.5" />
                Contributors
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                {summary.authors}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <TrendingUp className="w-3.5 h-3.5" />
                Last 7 days
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                {summary.recentCount}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Calendar className="w-3.5 h-3.5" />
                Latest commit
              </div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1 truncate">
                {summary.lastCommitDate ? timeAgo(summary.lastCommitDate) : '—'}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800">
            <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-1">
              Overall summary
            </h3>
            <p className="text-sm text-purple-800 dark:text-purple-300">
              {summary.total === 0
                ? 'No commits have been recorded yet.'
                : `${summary.total} commit${summary.total === 1 ? '' : 's'} by ${summary.authors} contributor${summary.authors === 1 ? '' : 's'}${summary.firstCommitDate && summary.lastCommitDate ? `, spanning ${new Date(summary.firstCommitDate).toLocaleDateString()} to ${new Date(summary.lastCommitDate).toLocaleDateString()}` : ''}. Recent work: ${commits.slice(0, 5).map((c) => c.message).join('; ')}${commits.length > 5 ? '; …' : ''}.`}
            </p>
          </div>
`
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
            {commits.map((c) => (
              <div
                key={c.sha}
                className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.avatarUrl}
                    alt={c.author}
                    className="w-8 h-8 rounded-full shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                    {c.author.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {c.message || '(no message)'}
                    </span>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gray-400 hover:text-purple-500 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    <span className="font-medium">{c.author}</span>
                    <span>•</span>
                    <span className="font-mono">{c.shortSha}</span>
                    <span>•</span>
                    <span>{timeAgo(c.date)}</span>
                  </div>
                </div>
              </div>
            ))}
            {commits.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No commits found on the default branch yet.
              </div>
            )}
          </div>

          {summary.hasMore && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Showing the latest 50 commits.
            </p>
          )}
        </>
      )}
    </div>
    <GithubReauthModal
      payload={reauthPayload}
      actionLabel="viewing commit history"
      returnTo={typeof window !== 'undefined' ? window.location.pathname : `/projects/${projectId}`}
      onDismiss={() => setReauthPayload(null)}
    />
  </>
)

}