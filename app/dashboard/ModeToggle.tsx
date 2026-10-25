'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Code, Crown, Loader2 } from 'lucide-react'

type ViewMode = 'dev' | 'owner'

const COOKIE_NAME = 'dave-view-mode'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}

export default function ModeToggle({ initialMode }: { initialMode: ViewMode }) {
  const router = useRouter()
  const [mode, setMode] = useState<ViewMode>(initialMode)
  const [pending, startTransition] = useTransition()

  const switchTo = (next: ViewMode) => {
    if (next === mode || pending) return
    setMode(next)
    setCookie(COOKIE_NAME, next, COOKIE_MAX_AGE)
    // Re-fetch the server-rendered dashboard with the new cookie value
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div
      role="group"
      aria-label="Switch view mode"
      className="inline-flex items-center bg-gray-100 dark:bg-gray-800/80 rounded-2xl border border-gray-200 dark:border-gray-700 p-1 relative shadow-sm"
    >
      {pending && (
        <Loader2 className="w-3.5 h-3.5 text-purple-500 animate-spin absolute -right-5 top-1/2 -translate-y-1/2" />
      )}
      <button
        type="button"
        onClick={() => switchTo('dev')}
        aria-pressed={mode === 'dev'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
          mode === 'dev'
            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30'
            : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
        }`}
        title="Switch to Developer view"
      >
        <Code className="w-3.5 h-3.5" />
        Developer
      </button>
      <button
        type="button"
        onClick={() => switchTo('owner')}
        aria-pressed={mode === 'owner'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
          mode === 'owner'
            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/30'
            : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
        }`}
        title="Switch to Owner view"
      >
        <Crown className="w-3.5 h-3.5" />
        Owner
      </button>
    </div>
  )
}