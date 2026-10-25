'use client';

import { useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  MessageCircle,
  Radar,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
} from 'lucide-react';
import GithubIcon from '@/components/GithubIcon';

/** A repository Pam found. Mirrors the server-side shape. */
interface PamRepo {
  fullName: string;
  url: string;
  owner: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  pushedAt: string | null;
  license: string | null;
}

/** One recommended repository, with Pam's reason. */
interface PamPick {
  fullName: string;
  why: string;
  fit: 'closest' | 'worth-a-look';
}

/** One question and the answer Pam gave it. */
interface Exchange {
  id: string;
  question: string;
  interpretation?: string;
  answer?: string;
  picks?: PamPick[];
  repos?: PamRepo[];
  searches?: string[];
  warnings?: string[];
  error?: string;
  loading?: boolean;
}

interface PamPanelProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
}

const EXAMPLE_QUESTIONS = [
  'Has anyone built a self-hosted kanban board with realtime collaboration?',
  'Is there an open-source app that generates changelogs from Git commits?',
  'Any existing Next.js + Supabase auth boilerplate worth starting from?',
  'How do people usually handle optimistic updates in React?',
];

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'updated today';
  if (days === 1) return 'updated yesterday';
  if (days < 30) return `updated ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `updated ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `updated ${years} year${years === 1 ? '' : 's'} ago`;
}

export function PamPanel({
  projectId,
  projectName,
  projectDescription,
}: PamPanelProps) {
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);
  const [asking, setAsking] = useState(false);
  // Monotonic counter for exchange ids. A ref rather than Date.now() so the
  // value is stable across renders.
  const exchangeCounter = useRef(0);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;

    const id = `q_${exchangeCounter.current++}`;
    setThread((prev) => [
      ...prev,
      { id, question: trimmed, loading: true },
    ]);
    setQuestion('');
    setAsking(true);

    try {
      const res = await fetch(`/api/pam/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pam could not answer that');

      setThread((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                loading: false,
                interpretation: data.interpretation,
                answer: data.answer,
                picks: data.picks || [],
                repos: data.repos || [],
                searches: data.searches || [],
                warnings: data.warnings || [],
              }
            : e
        )
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong';
      setThread((prev) =>
        prev.map((e) => (e.id === id ? { ...e, loading: false, error: message } : e))
      );
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center">
            <Radar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Pam</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              AI Research · &ldquo;Is there an app for that?&rdquo;
            </p>
          </div>
        </div>
        {thread.length > 0 && (
          <button
            onClick={() => setThread([])}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            New search
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 p-5 space-y-5 max-h-[520px] overflow-y-auto">
        {thread.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Before you build it, find out who built it first. Ask Pam a
              technical question and she will search{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                public GitHub
              </span>{' '}
              for projects that do something similar, and tell you which ones
              are worth a look.
            </p>

            {projectDescription?.trim() && (
              <div className="p-3 rounded-lg bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800 text-xs text-fuchsia-800 dark:text-fuchsia-300">
                <span className="font-semibold">Context:</span> she knows about{' '}
                <span className="font-semibold">{projectName}</span>, so you can
                ask her what already exists for this kind of project.
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Try one of these
              </p>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2"
                >
                  <Search className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((exchange) => (
          <div key={exchange.id} className="space-y-3">
            {/* The question */}
            <div className="flex justify-end">
              <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-tr-sm bg-purple-500 text-white text-sm shadow-sm">
                {exchange.question}
              </div>
            </div>

            {exchange.loading && (
              <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-fuchsia-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-fuchsia-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-fuchsia-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>Pam is searching GitHub…</span>
              </div>
            )}

            {exchange.error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{exchange.error}</span>
              </div>
            )}

            {!exchange.loading && !exchange.error && exchange.answer && (
              <>
                {/* Pam's answer */}
                <div className="rounded-xl bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800 p-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 text-fuchsia-600 dark:text-fuchsia-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
                      {exchange.answer}
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {(exchange.warnings || []).length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="space-y-1">
                      {(exchange.warnings || []).map((w, i) => (
                        <span key={i} className="block">
                          {w}
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {/* The matches */}
                {(exchange.picks || []).length > 0 && (
                  <div className="space-y-2">
                    {(exchange.picks || []).map((pick) => {
                      // Look the repo up within this exchange, so a repo that
                      // appears in two answers always renders with the
                      // metadata from that answer.
                      const repo = (exchange.repos || []).find(
                        (r) => r.fullName.toLowerCase() === pick.fullName.toLowerCase()
                      );
                      if (!repo) return null;
                      return (
                        <a
                          key={pick.fullName}
                          href={repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 hover:border-fuchsia-300 dark:hover:border-fuchsia-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <GithubIcon className="w-4 h-4 text-gray-700 dark:text-gray-300 flex-shrink-0" />
                              <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                                {repo.fullName}
                              </span>
                              {pick.fit === 'closest' ? (
                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300 flex-shrink-0">
                                  closest match
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 flex-shrink-0">
                                  worth a look
                                </span>
                              )}
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-fuchsia-500 flex-shrink-0" />
                          </div>

                          {repo.description && (
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 line-clamp-2">
                              {repo.description}
                            </p>
                          )}

                          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3" />
                              {formatStars(repo.stars)}
                            </span>
                            {repo.language && <span>{repo.language}</span>}
                            {repo.license && <span>{repo.license}</span>}
                            {relativeDate(repo.pushedAt) && (
                              <span>{relativeDate(repo.pushedAt)}</span>
                            )}
                          </div>

                          <p className="text-xs text-gray-700 dark:text-gray-300 mt-2 italic border-l-2 border-fuchsia-200 dark:border-fuchsia-800 pl-2">
                            {pick.why}
                          </p>
                        </a>
                      );
                    })}
                  </div>
                )}

                {/* What she searched for */}
                {(exchange.searches || []).length > 0 && (
                  <details className="text-xs text-gray-500 dark:text-gray-400">
                    <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none">
                      {(exchange.searches || []).length} GitHub{' '}
                      {(exchange.searches || []).length === 1 ? 'search' : 'searches'} run
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 pl-4 list-disc">
                      {(exchange.searches || []).map((s, i) => (
                        <li key={i}>
                          <code className="text-[11px]">{s}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
            placeholder="Ask Pam: has anyone built something like this?"
            rows={2}
            maxLength={500}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-fuchsia-500 outline-none resize-none"
          />
          <button
            onClick={() => ask(question)}
            disabled={asking || !question.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-600 hover:to-purple-700 text-white font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed h-[42px]"
          >
            {asking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Ask Pam
              </>
            )}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Pam searches public GitHub repositories — she never sees your private
          code.
        </p>
      </div>
    </div>
  );
}
