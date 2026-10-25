import { Briefcase } from 'lucide-react'

interface SpecializationTagsProps {
  /** Developer-declared specialty — what this person actually works on. */
  specialization?: string | null
  /** `chip` renders badges, `inline` renders plain muted text. */
  variant?: 'chip' | 'inline'
  /**
   * When true and the member has shared nothing, render an explicit
   * "no specialization shared" marker instead of nothing at all. Owners need
   * to be able to tell "this candidate shared nothing" apart from "this is
   * broken / not loaded".
   */
  showEmptyHint?: boolean
  className?: string
}

/**
 * Shows what a developer works on.
 *
 * The developer declares their own specialty, so team owners and Michael
 * always have a signal to work with.
 */
export function SpecializationTags({
  specialization,
  variant = 'chip',
  showEmptyHint = false,
  className = '',
}: SpecializationTagsProps) {
  const declared = specialization?.trim()

  if (!declared) {
    if (!showEmptyHint) return null
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 italic ${className}`}
      >
        <Briefcase className="w-3 h-3 shrink-0" />
        No specialization shared
      </span>
    )
  }

  if (variant === 'inline') {
    return (
      <span
        className={`inline-flex items-center gap-2 min-w-0 text-xs text-gray-600 dark:text-gray-300 ${className}`}
      >
        <span className="inline-flex items-center gap-1 min-w-0">
          <Briefcase className="w-3 h-3 shrink-0" />
          <span className="truncate">{declared}</span>
        </span>
      </span>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`}>
      <span
        className="inline-flex items-center gap-1.5 max-w-full min-w-0 px-2 py-1 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-medium border border-purple-500/20 dark:border-purple-500/30"
        title={declared}
      >
        <Briefcase className="w-3 h-3 shrink-0" />
        <span className="truncate">{declared}</span>
      </span>
    </div>
  )
}
