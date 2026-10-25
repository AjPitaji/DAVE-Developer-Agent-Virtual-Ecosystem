'use client'

import { useMemo, useState } from 'react'
import {
  CheckSquare,
  ChevronDown,
  Cpu,
  Flag,
  Info,
  Lightbulb,
  ListChecks,
  Palette,
  Rocket,
  Send,
  Trophy,
  Users,
} from 'lucide-react'
import type { ChallengeSection, ChallengeSectionKey, HackathonInfo } from '@/lib/types/hackathon'

const SECTION_ORDER: ChallengeSectionKey[] = [
  'about',
  'why_join',
  'what_to_build',
  'requirements',
  'what_to_submit',
  'judging',
  'get_started',
  'themes',
  'technologies',
  'prizes',
  'other',
]

const SECTION_ICONS: Record<ChallengeSectionKey, typeof Info> = {
  about: Info,
  why_join: Users,
  what_to_build: Lightbulb,
  requirements: ListChecks,
  what_to_submit: Send,
  judging: CheckSquare,
  prizes: Trophy,
  get_started: Rocket,
  technologies: Cpu,
  themes: Palette,
  other: Flag,
}

interface DisplayNode {
  section: ChallengeSection
  children: DisplayNode[]
}

function buildTree(sections: ChallengeSection[]): DisplayNode[] {
  const roots: DisplayNode[] = []
  const stack: DisplayNode[] = []

  for (const section of sections) {
    const node: DisplayNode = { section, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].section.level >= section.level) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }
    stack.push(node)
  }

  return roots
}

/** Order the top-level sections the way a reader expects to see them. */
function sortRoots(roots: DisplayNode[]): DisplayNode[] {
  return [...roots].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.section.key)
    const bi = SECTION_ORDER.indexOf(b.section.key)
    return (
      (ai === -1 ? SECTION_ORDER.length : ai) - (bi === -1 ? SECTION_ORDER.length : bi)
    )
  })
}

function SectionCard({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: DisplayNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const { section } = node
  const Icon = SECTION_ICONS[section.key] ?? Flag
  const isOpen = expanded.has(section.id)

  return (
    <div className={depth > 0 ? 'ml-4 sm:ml-6 border-l border-gray-200 dark:border-gray-700 pl-3 sm:pl-4' : ''}>
      <button
        type="button"
        onClick={() => onToggle(section.id)}
        className="w-full flex items-start gap-2.5 text-left group"
      >
        <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex-shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors">
            {section.title}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 mt-1 flex-shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="mt-2 mb-3 pl-[2.1rem]">
          <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
            {section.content}
          </div>
          {node.children.map((child) => (
            <div key={child.section.id} className="mt-3">
              <SectionCard
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
              />
            </div>
          ))}
        </div>
      )}

      {!isOpen && node.children.length > 0 && (
        <div className="ml-[2.1rem] mb-2">
          {node.children.map((child) => (
            <div key={child.section.id} className="mb-2">
              <SectionCard
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChallengeBrief({
  hackathon,
  defaultExpanded = ['about', 'what_to_build', 'what_to_submit'],
}: {
  hackathon: HackathonInfo
  defaultExpanded?: string[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(defaultExpanded))

  const tree = useMemo(
    () => sortRoots(buildTree(hackathon.sections)),
    [hackathon.sections]
  )

  function onToggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const chips = [
    ...(hackathon.theme ? [hackathon.theme] : []),
    ...hackathon.tags.filter((tag) => tag !== hackathon.theme).slice(0, 6),
  ]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
            {hackathon.title || 'Hackathon challenge'}
          </h2>
          {hackathon.url && (
            <a
              href={hackathon.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline mt-1"
            >
              View on DevPost
            </a>
          )}
        </div>
        {hackathon.deadline && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">
            <Flag className="w-3 h-3" />
            {new Date(hackathon.deadline).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {chips.map((chip) => (
            <span
              key={chip}
              className="px-3 py-1 text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {hackathon.technologies.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            Technologies listed by the organizers
          </p>
          <div className="flex flex-wrap gap-2">
            {hackathon.technologies.map((tech) => (
              <span
                key={tech}
                className="px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {tree.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          We could not split this page into sections. The raw summary is below.
        </p>
      ) : (
        <div className="space-y-3">
          {tree.map((node) => (
            <SectionCard
              key={node.section.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}

      {hackathon.description && tree.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
          {hackathon.description}
        </p>
      )}
    </div>
  )
}
