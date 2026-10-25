'use client'

import { AlertCircle, ArrowRight, Lightbulb, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react'
import type { ProjectIdea } from '@/lib/types/idea'

export function IdeaPicker({
  ideas,
  loading,
  error,
  onRetry,
  onSelect,
  ownIdea,
  onOwnIdeaChange,
  onUseOwnIdea,
}: {
  ideas: ProjectIdea[]
  loading: boolean
  error: string
  onRetry: () => void
  onSelect: (idea: ProjectIdea) => void
  ownIdea: string
  onOwnIdeaChange: (value: string) => void
  onUseOwnIdea: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex p-3.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl mb-3 shadow-lg shadow-violet-500/40">
          <Lightbulb className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1.5">
          What should you build?
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm max-w-lg mx-auto">
          These ideas are grounded in the challenge brief above — each one is scoped to fit
          the requirements and the time you have left. Pick one, or bring your own.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-semibold hover:underline"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {loading && ideas.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 animate-pulse"
            >
              <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
              <div className="h-3 w-full bg-gray-100 dark:bg-gray-700 rounded mb-2" />
              <div className="h-3 w-4/5 bg-gray-100 dark:bg-gray-700 rounded mb-4" />
              <div className="h-9 w-28 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {loading && ideas.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Refreshing ideas…
        </div>
      )}

      {!loading && !error && ideas.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
          No ideas came back. Try again, or bring your own idea below.
        </div>
      )}

      {ideas.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="group bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 flex flex-col hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-lg hover:shadow-violet-500/10 transition-all duration-300"
            >
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                {idea.name}
              </h3>
              {idea.tagline && (
                <p className="text-sm text-violet-600 dark:text-violet-400 font-medium mb-2.5">
                  {idea.tagline}
                </p>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed flex-1 mb-3">
                {idea.description}
              </p>

              {idea.techStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {idea.techStack.map((tech) => (
                    <span
                      key={tech}
                      className="px-2 py-0.5 text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              )}

              {idea.whyItFits && (
                <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-3 border-l-2 border-violet-200 dark:border-violet-900 pl-2">
                  {idea.whyItFits}
                </p>
              )}

              <button
                onClick={() => onSelect(idea)}
                className="inline-flex items-center justify-center gap-1.5 w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-sm font-semibold py-2.5 px-4 rounded-xl shadow-md shadow-violet-500/25 hover:shadow-lg transition-all"
              >
                Build this
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Pencil className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Or bring your own idea
          </h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Rough is fine. The consultant will help you turn it into a real plan.
        </p>
        <textarea
          value={ownIdea}
          onChange={(e) => onOwnIdeaChange(e.target.value)}
          rows={3}
          placeholder="e.g. An app that helps first-year students find study groups based on their course schedule"
          className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none resize-none text-sm mb-3"
        />
        <button
          onClick={onUseOwnIdea}
          disabled={!ownIdea.trim()}
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 font-semibold text-sm py-2.5 px-5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4" />
          Shape it with the consultant
        </button>
      </div>
    </div>
  )
}
