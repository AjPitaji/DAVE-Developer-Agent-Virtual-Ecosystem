'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  MessageSquare,
  Plus,
  Send,
  User,
  X,
} from 'lucide-react'
import type { ConsultantDraft, ConsultantMessage } from '@/lib/types/idea'

export function ConsultantChat({
  messages,
  draft,
  loading,
  error,
  onSend,
  onDraftChange,
  onContinue,
  canContinue,
}: {
  messages: ConsultantMessage[]
  draft: ConsultantDraft
  loading: boolean
  error: string
  onSend: (message: string) => void
  onDraftChange: (draft: ConsultantDraft) => void
  onContinue: () => void
  canContinue: boolean
}) {
  const [input, setInput] = useState('')
  const [newTech, setNewTech] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, loading])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return
    onSend(input.trim())
    setInput('')
  }

  function addTech() {
    const tech = newTech.trim()
    if (!tech) return
    if (draft.techStack.some((t) => t.toLowerCase() === tech.toLowerCase())) {
      setNewTech('')
      return
    }
    onDraftChange({ ...draft, techStack: [...draft.techStack, tech] })
    setNewTech('')
  }

  function removeTech(tech: string) {
    onDraftChange({
      ...draft,
      techStack: draft.techStack.filter((t) => t !== tech),
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      {/* Conversation */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
            <Bot className="w-4 h-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Shape it with your consultant
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Talk it through — the draft updates as you go.
            </p>
          </div>
        </div>

        <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1 mb-4">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div key={index} className="flex justify-end gap-2">
                <div className="max-w-[85%] bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 flex-shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </span>
              </div>
            ) : (
              <div key={index} className="flex justify-start gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex-shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </span>
                <div className="max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="flex justify-start gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </span>
              <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-blink"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2.5 rounded-xl text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Make it work offline, focus on students, add a demo…"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none text-sm"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="inline-flex items-center justify-center w-12 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-md shadow-violet-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Live draft */}
      <div className="lg:sticky lg:top-6 bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Working draft
          </h3>
        </div>

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          Project name
        </label>
        <input
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          placeholder="Untitled idea"
          className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none text-sm mb-4"
        />

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          Description
        </label>
        <textarea
          value={draft.description}
          onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
          rows={6}
          placeholder="What you're building"
          className="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none resize-none text-sm mb-4"
        />

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          Tech stack
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {draft.techStack.map((tech) => (
            <span
              key={tech}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg"
            >
              {tech}
              <button
                onClick={() => removeTech(tech)}
                aria-label={`Remove ${tech}`}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {draft.techStack.length === 0 && (
            <span className="text-[11px] text-gray-400">Nothing picked yet</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newTech}
            onChange={(e) => setNewTech(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTech()
              }
            }}
            placeholder="Add technology"
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all outline-none text-xs"
          />
          <button
            onClick={addTech}
            aria-label="Add technology"
            className="inline-flex items-center justify-center w-8 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-semibold py-3 px-5 rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" />
          Looks good — set up the project
        </button>
      </div>
    </div>
  )
}
