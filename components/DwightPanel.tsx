'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  FileCode,
  XCircle,
  Eye,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  RefreshCw,
  Play,
  Info,
  X,
  Terminal,
} from 'lucide-react';
import GithubIcon from '@/components/GithubIcon';
import { GithubReauthModal } from '@/components/GithubReauthModal';
import {
  GithubReauthPayload,
  extractGithubReauth,
} from '@/lib/github/client';

// ---------------------------------------------------------------------------
// Types — mirror the rows returned by /api/dwight/*
// ---------------------------------------------------------------------------

type Verdict = 'approved' | 'changes_requested' | 'comment';
type Severity = 'info' | 'minor' | 'major' | 'critical';
type ReviewStatus = 'pending' | 'completed' | 'failed';
type LogStatus = 'started' | 'ok' | 'error' | 'info';

interface LogEntry {
  ts: string;
  step: string;
  status: LogStatus;
  detail?: string;
  duration_ms?: number;
}

interface FileFinding {
  path: string;
  summary: string;
  severity: Severity;
  note?: string;
}

interface Review {
  id: string;
  project_id: string;
  task_id: string;
  verdict: Verdict;
  summary: string;
  findings: FileFinding[];
  body_markdown: string;
  branch: string;
  commit_sha: string;
  commit_short_sha: string;
  commit_message: string;
  files_reviewed: string[];
  pr_number: number | null;
  pr_url: string | null;
  log: LogEntry[];
  status: ReviewStatus;
  error_message: string | null;
  triggered_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewTarget {
  taskId: string;
  prNumber: number | null;
}

interface DwightPanelProps {
  projectId: string;
  hasRepo: boolean;
  repoUrl: string | null;
  // The most-recent task the user just moved to done.
  // If prNumber is set, Dwight auto-runs immediately.
  // If prNumber is null, the panel prompts the user to enter a PR number
  // before running the review.
  freshlyDoneTask?: ReviewTarget | null;
  onClearFreshlyDoneTask?: () => void;
  // Fired after Dwight finishes a review (auto-trigger or re-run) so the
  // parent can reload the task list. The verdict may have flipped the
  // task to "done" (accepted) or "in_progress" (changes requested), so
  // the board needs to reflect that without a manual refresh.
  onTaskChanged?: () => void;
  // Called when the review API returns PR_NOT_FOUND for a task so the
  // parent can show a "PR not found" badge on the task card.
  onPrNotFound?: (taskId: string) => void;
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

const VERDICT_META: Record<
  Verdict,
  { label: string; chip: string; ring: string; icon: React.ComponentType<{ className?: string }> }
> = {
  approved: {
    label: 'Approved',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    ring: 'border-emerald-300 dark:border-emerald-700',
    icon: ShieldCheck,
  },
  changes_requested: {
    label: 'Changes requested',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    ring: 'border-rose-300 dark:border-rose-700',
    icon: ShieldAlert,
  },
  comment: {
    label: 'Comment only',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    ring: 'border-sky-300 dark:border-sky-700',
    icon: MessageSquare,
  },
};

const SEVERITY_META: Record<
  Severity,
  { label: string; chip: string; dot: string }
> = {
  info: {
    label: 'Info',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    dot: 'bg-gray-400',
  },
  minor: {
    label: 'Minor',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  major: {
    label: 'Major',
    chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  critical: {
    label: 'Critical',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// A "stuck" review is one that's been pending for more than 2 minutes
// without a finished verdict. The server's auto-fail sweep kicks in at
// 10 minutes, but we surface a warning much sooner so the user can act.
const STUCK_THRESHOLD_MS = 2 * 60 * 1000;
// Empty-log reviews only get a recovery banner after this grace period.
// A fresh review can legitimately be empty for a few hundred ms while
// Dwight is still doing the first GitHub call.
const EMPTY_LOG_GRACE_MS = 30 * 1000;

function isStuck(review: Review, now: number = Date.now()): boolean {
  if (review.status !== 'pending') return false;
  const started = new Date(review.created_at).getTime();
  if (Number.isNaN(started)) return false;
  return now - started > STUCK_THRESHOLD_MS;
}

// True when a pending review has been silent (empty log) for longer than
// the grace period. New reviews can be empty for a few hundred ms while
// Dwight is still doing the first GitHub call, so we wait before alarming.
function isEmptyLogRecovery(review: Review, now: number = Date.now()): boolean {
  if (review.status !== 'pending') return false;
  if (review.log && review.log.length > 0) return false;
  const started = new Date(review.created_at).getTime();
  if (Number.isNaN(started)) return false;
  return now - started > EMPTY_LOG_GRACE_MS;
}

function stuckDurationLabel(iso: string, now: number = Date.now()): string {
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return '';
  const diff = now - started;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DwightPanel({
  projectId,
  hasRepo,
  repoUrl,
  freshlyDoneTask,
  onClearFreshlyDoneTask,
  onTaskChanged,
  onPrNotFound,
}: DwightPanelProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Set by the list endpoint when it had to fall back to a no-log select.
  // The Dwight tab surfaces a "run the migration" banner so the user
  // knows the activity terminal is empty because the schema is missing
  // the `log` column, not because Dwight is doing nothing.
  const [logColumnMissing, setLogColumnMissing] = useState(false);
  // The review id of an in-flight "run Dwight now" / auto-trigger request, so
  // we can mark the matching row as pending in the list.
  const [runningReviewId, setRunningReviewId] = useState<string | null>(null);
  const [runningError, setRunningError] = useState('');
  // The task we're currently running Dwight on (display + disable state).
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  // Set when the backend says our GitHub token is no longer valid.
  // Rendered as a modal so the user can re-auth with one click instead
  // of hunting down Settings.
  const [reauthPayload, setReauthPayload] = useState<GithubReauthPayload | null>(null);
  // When a task lands in Done without a stored PR number, we show an
  // inline prompt here instead of auto-triggering. null means no prompt.
  const [pendingPrLinkTask, setPendingPrLinkTask] = useState<string | null>(null);
  const [prLinkInput, setPrLinkInput] = useState('');
  const [prLinkError, setPrLinkError] = useState('');

  // Track the last `freshlyDoneTaskId` we acted on so we don't re-fire on
  // every render or on a parent re-render with the same id.
  const lastTriggeredRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // List loader
  // -------------------------------------------------------------------------
  const loadReviews = useCallback(async () => {
    try {
      const res = await fetch(`/api/dwight/${projectId}/reviews?limit=25`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load reviews');
      }
      const data = await res.json();
      const list: Review[] = data.reviews ?? [];
      setReviews(list);
      setLogColumnMissing(Boolean(data.logColumnMissing));
      // If the current selection no longer exists, drop it so the detail
      // pane doesn't render a stale ghost.
      setSelectedId((current) => {
        if (current && list.some((r) => r.id === current)) return current;
        return list[0]?.id ?? null;
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial mount only. Subsequent reloads go through the explicit Refresh
  // button or the auto-poll after a new review, both of which call
  // loadReviews() directly. We deliberately avoid resetting loading/error
  // here — the effect rule forbids synchronous setState in effects, and
  // re-fetching on every dependency change would mask the user's selection.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    loadReviews();
  }, [loadReviews]);

  // -------------------------------------------------------------------------
  // Live polling — while any review is "pending", reload the list every 1.5s
  // so the activity log terminal streams progress in real time. Also tell
  // the page to refresh tasks so the verdict-applied move shows up on the
  // board the moment Dwight finishes.
  // -------------------------------------------------------------------------
  const anyPending = reviews.some((r) => r.status === 'pending');
  useEffect(() => {
    if (!anyPending) return;
    const handle = setInterval(() => {
      void loadReviews();
      onTaskChanged?.();
    }, 1500);
    return () => clearInterval(handle);
  }, [anyPending, loadReviews, onTaskChanged]);

  // -------------------------------------------------------------------------
  // Auto-trigger Dwight when the page reports a freshly-done task. If
  // the task has a PR linked, route to the PR-review endpoint so Dwight
  // reviews the PR diff instead of the default-branch HEAD.
  // -------------------------------------------------------------------------
  const triggerReview = useCallback(
    async (target: ReviewTarget) => {
      if (!hasRepo) return;
      setRunningTaskId(target.taskId);
      setRunningError('');
      try {
        const endpoint = target.prNumber
          ? `/api/dwight/${projectId}/review-pr`
          : `/api/dwight/${projectId}/review`;
        const body = target.prNumber
          ? { taskId: target.taskId, prNumber: target.prNumber }
          : { taskId: target.taskId };
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          // If the server reported a re-auth requirement, surface a
          // modal instead of a dead-end error. The modal triggers a
          // round trip back to /api/auth/github/authorize which lands
          // the user back here; the consumeRetry() hook on the parent
          // page (or a manual re-run) replays the action.
          const reauth = extractGithubReauth(data);
          if (reauth) {
            setReauthPayload(reauth);
            throw new Error(reauth.error);
          }
          // "PR not found" isn't a crash — the server deliberately
          // bounced the task back to In Progress and wrote a failed
          // review row. Notify the parent so it can show a badge on
          // the card, refresh the list so the panel shows the explanation,
          // and tell the parent to re-render the board so the card
          // visibly moves out of Done.
          if (data.code === 'PR_NOT_FOUND') {
            setRunningError(data.error || 'PR not found — Dwight did not run.');
            onPrNotFound?.(target.taskId);
            await loadReviews();
            onTaskChanged?.();
            return;
          }
          throw new Error(data.error || 'Dwight failed');
        }
        // The new review row is in `data.review`. Mark it running + selected
        // and refresh the list so it shows up in chronological order.
        if (data.review?.id) {
          setRunningReviewId(data.review.id);
          setSelectedId(data.review.id);
        }
        await loadReviews();
        // Dwight's API applies the verdict to the task synchronously, so by
        // the time the fetch resolves the task has already moved (to "done"
        // or "in_progress"). Tell the parent to reload the board so the
        // user sees the new column / status without a manual refresh.
        onTaskChanged?.();
        // Poll once more after a short delay so a long-running review flips
        // from pending to completed without requiring the user to refresh.
        setTimeout(() => {
          loadReviews();
          onTaskChanged?.();
          setRunningReviewId(null);
        }, 4000);
      } catch (err) {
        setRunningError(err instanceof Error ? err.message : 'Dwight failed');
      } finally {
        setRunningTaskId(null);
        onClearFreshlyDoneTask?.();
      }
    },
    [hasRepo, projectId, loadReviews, onClearFreshlyDoneTask, onTaskChanged, onPrNotFound]
  );

  // -------------------------------------------------------------------------
  // Handle freshly-done tasks. If the task already has a PR number stored,
  // trigger Dwight immediately. Otherwise, show a prompt so the user can
  // enter the PR number before Dwight reviews.
  // -------------------------------------------------------------------------
  const submitPrLink = useCallback(async (taskId: string, prNumberStr: string) => {
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      setPrLinkError('Enter a valid PR number.');
      return;
    }
    setPendingPrLinkTask(null);
    setPrLinkInput('');
    setPrLinkError('');
    await triggerReview({ taskId, prNumber });
  }, [triggerReview]);

  useEffect(() => {
    if (!freshlyDoneTask) return;
    const key = `${freshlyDoneTask.taskId}:${freshlyDoneTask.prNumber ?? 'default'}`;
    if (lastTriggeredRef.current === key) return;
    lastTriggeredRef.current = key;
    if (freshlyDoneTask.prNumber !== null) {
      triggerReview(freshlyDoneTask);
    } else {
      setPendingPrLinkTask(freshlyDoneTask.taskId);
      onClearFreshlyDoneTask?.();
    }
  }, [freshlyDoneTask, triggerReview, onClearFreshlyDoneTask]);

  // -------------------------------------------------------------------------
  // Manual re-run on the currently selected review (re-runs against the
  // current latest commit on the default branch).
  // -------------------------------------------------------------------------
  async function handleRerun() {
    const target = reviews.find((r) => r.id === selectedId);
    if (!target) return;
    await triggerReview({
      taskId: target.task_id,
      prNumber: target.pr_number,
    });
  }

  // Mark the currently-selected review as `failed` so the user can
  // escape a stuck run. The task itself stays in `under_review` — they
  // can re-run or drag the task back manually.
  const [cancelling, setCancelling] = useState(false);
  async function handleCancel() {
    const target = reviews.find((r) => r.id === selectedId);
    if (!target || target.status !== 'pending') return;
    if (!confirm('Cancel this stuck review? The task will stay under review until you re-run Dwight or move it manually.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/dwight/${projectId}/reviews/${target.id}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Cancel failed');
      }
      await loadReviews();
      onTaskChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const selected = useMemo(
    () => reviews.find((r) => r.id === selectedId) ?? null,
    [reviews, selectedId]
  );

  if (!hasRepo) {
    return (
      <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Dwight</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Code Reviewer · &ldquo;Fact: bugs fear me.&rdquo;
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
          <p>
            Link a GitHub repo to this project first — Dwight reviews the
            default branch and can&apos;t do his job without one. Once it&apos;s
            linked, every task you mark done gets an automatic code review.
          </p>
        </div>
        {repoUrl && (
          <div className="px-5 pb-5 -mt-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Linked repo: <span className="font-mono">{repoUrl}</span>
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Missing-log-column banner — only renders when the API has to
          fall back to a no-log select because the migration wasn't run. */}
      {logColumnMissing && (
        <div className="p-3 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Activity log column is missing on this database.</p>
            <p className="mt-0.5 opacity-90">
              Run the migration{' '}
              <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded text-[11px]">
                20261016000000_dwight_log_column.sql
              </code>{' '}
              in the Supabase SQL Editor, then cancel any in-flight review and re-run Dwight to see the live terminal.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Dwight</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Code Reviewer · runs on every task marked done
            </p>
          </div>
          <div className="flex ml-auto bg-gray-100 dark:bg-gray-900/60 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={loadReviews}
              className="px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Reload"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* One-time error banner */}
      {(error || runningError) && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{runningError || error}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-gray-200 dark:divide-gray-700">
        {/* Review list */}
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Recent reviews
          </h4>
          {loading && reviews.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : reviews.length === 0 ? (
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400">
              <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                No reviews yet.
              </p>
              <p>
                Dwight fires automatically when you drag a task to <em>Done</em>.
                If the task has a PR number stored, he reviews it right away.
                Otherwise, he&apos;ll ask you for the PR number first.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {reviews.map((r) => {
                const meta = VERDICT_META[r.verdict] ?? VERDICT_META.comment;
                const Icon = meta.icon;
                const isSelected = r.id === selectedId;
                const isRunning = runningReviewId === r.id || (runningTaskId && r.task_id === runningTaskId);
                const stuck = isStuck(r);
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all duration-200 ${
                        isSelected
                          ? `${meta.ring} bg-rose-50/40 dark:bg-rose-900/10 shadow-sm`
                          : stuck
                          ? 'border-amber-300 dark:border-amber-700/70 hover:border-amber-400 dark:hover:border-amber-600'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900/40'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}
                        >
                          {isRunning && r.status === 'pending' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Icon className="w-3 h-3" />
                          )}
                          {isRunning && r.status === 'pending' ? 'Reviewing' : meta.label}
                        </span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                          {relativeTime(r.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2">
                        {r.summary || r.commit_message || 'Review'}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
                        {r.commit_short_sha && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitCommit className="w-3 h-3" />
                            {r.commit_short_sha}
                          </span>
                        )}
                        {r.pr_number && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitPullRequest className="w-3 h-3" />
                            PR #{r.pr_number}
                          </span>
                        )}
                        {r.branch && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitBranch className="w-3 h-3" />
                            {r.branch}
                          </span>
                        )}
                        {stuck && (
                          <span
                            className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold"
                            title={`Pending for ${stuckDurationLabel(r.created_at)}`}
                          >
                            <AlertCircle className="w-3 h-3" />
                            Stuck {stuckDurationLabel(r.created_at)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Review detail */}
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {pendingPrLinkTask ? (
            <PrLinkPrompt
              taskId={pendingPrLinkTask}
              inputValue={prLinkInput}
              error={prLinkError}
              onChange={setPrLinkInput}
              onClearError={() => setPrLinkError('')}
              onSubmit={submitPrLink}
              onSkip={() => setPendingPrLinkTask(null)}
            />
          ) : !selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 py-10">
              <Sparkles className="w-8 h-8 mb-3 text-rose-400" />
              <p className="font-semibold text-gray-700 dark:text-gray-300">
                Pick a review on the left
              </p>
              <p className="text-sm mt-1">
                Or move a task to <em>Done</em> on the board and Dwight will
                start one for you.
              </p>
            </div>
          ) : (
            <ReviewDetail
              review={selected}
              isRunning={runningReviewId === selected.id || (runningTaskId === selected.task_id && selected.status === 'pending')}
              onRerun={handleRerun}
              onCancel={handleCancel}
              cancelling={cancelling}
            />
          )}
        </div>
      </div>

      {/* GitHub re-auth modal. Shown when a Dwight review or re-run fails
          with GITHUB_REAUTH_REQUIRED. The primary CTA kicks off the OAuth
          round trip; we land back here and the user can re-trigger Dwight
          with one more click. */}
      <GithubReauthModal
        payload={reauthPayload}
        actionLabel="running Dwight"
        returnTo={
          typeof window !== 'undefined' ? window.location.pathname : `/projects/${projectId}`
        }
        onDismiss={() => setReauthPayload(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail pane
// ---------------------------------------------------------------------------

function ReviewDetail({
  review,
  isRunning,
  onRerun,
  onCancel,
  cancelling,
}: {
  review: Review;
  isRunning: boolean;
  onRerun: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const meta = VERDICT_META[review.verdict] ?? VERDICT_META.comment;
  const Icon = meta.icon;

  return (
    <div className="space-y-4">
      {/* Verdict header */}
      <div className={`rounded-xl border p-4 ${meta.ring}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isRunning && review.status === 'pending' ? (
              <Loader2 className="w-5 h-5 text-rose-500 animate-spin" />
            ) : (
              <Icon className="w-5 h-5 text-rose-500" />
            )}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${meta.chip}`}
            >
              {isRunning && review.status === 'pending' ? 'Reviewing' : meta.label}
            </span>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {new Date(review.created_at).toLocaleString()}
          </span>
        </div>
        <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
          {review.summary}
        </p>
        {review.error_message && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
            {review.error_message}
          </p>
        )}
      </div>

      {/* Commit metadata */}
      {(review.commit_short_sha || review.pr_number || review.branch || review.commit_message) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
          {review.commit_short_sha && (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitCommit className="w-3.5 h-3.5" />
              {review.commit_short_sha}
            </span>
          )}
          {review.pr_number && (
            review.pr_url ? (
              <a
                href={review.pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-300 hover:underline"
                title={`Open PR #${review.pr_number}`}
              >
                <GitPullRequest className="w-3.5 h-3.5" />
                PR #{review.pr_number}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono">
                <GitPullRequest className="w-3.5 h-3.5" />
                PR #{review.pr_number}
              </span>
            )
          )}
          {review.commit_message && (
            <span className="truncate max-w-xs">{review.commit_message}</span>
          )}
          {review.branch && (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch className="w-3.5 h-3.5" />
              {review.branch}
            </span>
          )}
        </div>
      )}

      {/* Findings */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
          <Eye className="w-3.5 h-3.5" />
          Findings ({review.findings.length})
        </h4>
        {review.findings.length === 0 ? (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            No findings — Dwight has nothing to flag.
          </div>
        ) : (
          <ul className="space-y-2">
            {review.findings.map((f, i) => {
              const sev = SEVERITY_META[f.severity] ?? SEVERITY_META.minor;
              return (
                <li
                  key={`${f.path}-${i}`}
                  className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">
                      <FileCode className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
                      {f.path}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${sev.chip}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                      {sev.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-200">
                    {f.summary}
                  </p>
                  {f.note && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      {f.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Files reviewed */}
      {review.files_reviewed.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Files reviewed ({review.files_reviewed.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {review.files_reviewed.map((p) => (
              <span
                key={p}
                className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[10px] font-mono text-gray-700 dark:text-gray-300"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body markdown */}
      {review.body_markdown && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Notes
          </h4>
          <pre className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono">
            {review.body_markdown}
          </pre>
        </div>
      )}

      {/* Live activity terminal — shows every step Dwight ran. The parent
          polls every 1.5s while this review is pending, so new entries
          appear in real time. */}
      <LiveActivityLog log={review.log} status={review.status} />

      {/* Stuck-review notice — only shown for `pending` reviews that have
          exceeded the stuck threshold. Explains the situation and offers a
          Cancel button so the user can escape without waiting. */}
      {review.status === 'pending' && (
        <StuckNotice
          review={review}
          onCancel={onCancel}
          cancelling={cancelling}
        />
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onRerun}
          disabled={isRunning}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          title="Re-run Dwight against the latest commit on the default branch"
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {review.pr_number ? `Re-run on PR #${review.pr_number}` : 'Re-run on latest commit'}
        </button>
        {review.status === 'pending' && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Mark this stuck review as failed. The task itself stays under review until you re-run Dwight or move it manually."
          >
            {cancelling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            Cancel stuck review
          </button>
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
          <GithubIcon className="w-3 h-3" />
          Reviews target the repo&apos;s default branch.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PrLinkPrompt
//
// Shown in the detail pane when a task lands in Done without a stored PR
// number. The user types the PR number and Dwight reviews it explicitly.
// ---------------------------------------------------------------------------

function PrLinkPrompt({
  taskId,
  inputValue,
  error,
  onChange,
  onClearError,
  onSubmit,
  onSkip,
}: {
  taskId: string;
  inputValue: string;
  error: string;
  onChange: (v: string) => void;
  onClearError: () => void;
  onSubmit: (taskId: string, prNumber: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(taskId, inputValue.trim());
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 p-4 bg-amber-50/50 dark:bg-amber-900/10">
        <div className="flex items-center gap-2 mb-2">
          <GitPullRequest className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold text-gray-800 dark:text-gray-200">
            Link a PR to review
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          This task was moved to <em>Done</em> but has no PR linked yet.
          Enter the PR number below and Dwight will review it.
        </p>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <GitPullRequest className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => { onChange(e.target.value); onClearError(); }}
              placeholder="e.g. 42"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-sm font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Review
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            Skip
          </button>
        </form>
        {error && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        You can also set the PR number on the task later and Dwight will review
        it automatically next time.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StuckNotice
//
// Inline explanation shown above the action row when a review is `pending`
// and either the log is empty (started before logging was enabled) or the
// review has been hanging for more than the stuck threshold.
// ---------------------------------------------------------------------------

function StuckNotice({
  review,
  onCancel,
  cancelling,
}: {
  review: Review;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const stuck = isStuck(review);
  const showEmptyLogRecovery = isEmptyLogRecovery(review);

  if (!stuck && !showEmptyLogRecovery) return null;

  return (
    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          {stuck && (
            <p>
              <span className="font-semibold">This review is stuck.</span>{' '}
              It&apos;s been pending for{' '}
              <span className="font-mono font-semibold">
                {stuckDurationLabel(review.created_at)}
              </span>
              . The server may have crashed mid-run.
            </p>
          )}
          {!stuck && showEmptyLogRecovery && (
            <p>
              <span className="font-semibold">No activity recorded yet.</span>{' '}
              The activity log column may be missing on this database. The
              review itself is still running, but you won&apos;t see step-by-step
              progress until the migration is applied.
            </p>
          )}
          <p className="text-amber-700 dark:text-amber-400">
            Re-run Dwight to start a fresh review, or cancel this one to
            unblock the task.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <button
          onClick={onCancel}
          disabled={cancelling}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelling ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <X className="w-3 h-3" />
          )}
          Cancel this review
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveActivityLog
//
// Renders the per-step log streamed by the Dwight API. The parent polls
// every 1.5s while a review is "pending", so the terminal fills up in
// real time. Once the review completes (or fails) it stays put as a
// forensic record of what Dwight actually did.
// ---------------------------------------------------------------------------

function LiveActivityLog({ log, status }: { log: LogEntry[]; status: ReviewStatus }) {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom whenever a new entry lands, but only while
  // the review is still running — once it's done, freeze the scroll so
  // the user can read the trace without it jumping.
  useEffect(() => {
    if (status !== 'pending') return;
    const el = terminalRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log, status]);

  if (!log || log.length === 0) {
    const isPending = status === 'pending';
    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
          <Terminal className="w-3.5 h-3.5" />
          Activity
          {isPending && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal text-rose-600 dark:text-rose-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              live
            </span>
          )}
        </h4>
        <div className="rounded-xl border border-slate-800 bg-slate-950 dark:bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
          {isPending ? (
            <>
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                <span className="animate-pulse">Waiting for first log entry…</span>
              </div>
              <p className="mt-2 text-slate-500 normal-case font-sans text-[11px]">
                If this sits empty for more than a few seconds, the activity-log
                column may be missing on the database. Run{' '}
                <code className="bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-[10px]">
                  20261016000000_dwight_log_column.sql
                </code>{' '}
                in the Supabase SQL Editor, then cancel and re-run this review.
              </p>
            </>
          ) : (
            <p>No activity recorded for this review.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
        <Terminal className="w-3.5 h-3.5" />
        Activity
        {status === 'pending' && (
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-normal text-rose-600 dark:text-rose-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            live
          </span>
        )}
      </h4>
      <div
        ref={terminalRef}
        className="rounded-xl bg-slate-950 dark:bg-black/80 border border-slate-800 p-3 max-h-72 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-200"
      >
        {log.map((entry, i) => {
          const time = entry.ts ? new Date(entry.ts) : null;
          const hh = time ? String(time.getHours()).padStart(2, '0') : '--';
          const mm = time ? String(time.getMinutes()).padStart(2, '0') : '--';
          const ss = time ? String(time.getSeconds()).padStart(2, '0') : '--';
          return (
            <div
              key={`${entry.ts}-${i}`}
              className="flex items-start gap-2 py-0.5"
            >
              <span className="text-slate-500 select-none">[{hh}:{mm}:{ss}]</span>
              {entry.status === 'started' ? (
                <Loader2 className="w-3 h-3 mt-0.5 text-rose-400 animate-spin flex-shrink-0" />
              ) : entry.status === 'ok' ? (
                <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
              ) : entry.status === 'error' ? (
                <X className="w-3 h-3 mt-0.5 text-rose-400 flex-shrink-0" />
              ) : (
                <Info className="w-3 h-3 mt-0.5 text-sky-400 flex-shrink-0" />
              )}
              <span
                className={
                  entry.status === 'error'
                    ? 'text-rose-300'
                    : entry.status === 'ok'
                    ? 'text-emerald-300'
                    : entry.status === 'started'
                    ? 'text-rose-200'
                    : 'text-sky-200'
                }
              >
                {entry.step}
                {typeof entry.duration_ms === 'number' && entry.status === 'ok' && (
                  <span className="text-slate-500"> · {entry.duration_ms}ms</span>
                )}
              </span>
              {entry.detail && (
                <span className="text-slate-400 break-all">— {entry.detail}</span>
              )}
            </div>
          );
        })}
        {status === 'pending' && (
          <div className="flex items-center gap-2 py-0.5 text-slate-500">
            <span className="select-none">[--:--:--]</span>
            <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
            <span className="animate-pulse">…</span>
          </div>
        )}
      </div>
    </div>
  );
}