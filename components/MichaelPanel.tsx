'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Trash2,
  RotateCcw,
  Plus,
  ChevronDown,
  GitBranch,
  Info,
  Check,
} from 'lucide-react';
import type { TaskPriority } from '@/lib/agents/michael';

interface TeamMember {
  user_id: string;
  name: string;
  /** What this member specializes in — the specialty they declared
   *  themselves. This is what Michael uses to route tasks. Null when unset. */
  specialization?: string | null;
}

interface ProposedTask {
  clientId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  suggestedAssigneeId?: string;
  rationale: string;
}

/** What Michael managed to read out of the repository on the last run. */
interface RepoInfo {
  repoFullName: string | null;
  defaultBranch: string | null;
  totalFiles: number;
  filesRead: number;
  languages: string;
  notes: string[];
}

interface MichaelPanelProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  hasRepo: boolean;
  teamMembers: TeamMember[];
  onTasksCreated?: () => void;
}

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { value: 'high', label: 'High', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
];

const BRIEF_PLACEHOLDER =
  'e.g. Focus on the landing page first. Split the backend work into smaller tasks. ' +
  'The demo must include authentication and a working GitHub link.';

function priorityColor(p: TaskPriority) {
  return PRIORITIES.find((x) => x.value === p)?.color ?? PRIORITIES[1].color;
}

export function MichaelPanel({
  projectId,
  projectName,
  projectDescription,
  hasRepo,
  teamMembers,
  onTasksCreated,
}: MichaelPanelProps) {
  const [proposals, setProposals] = useState<ProposedTask[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [successCount, setSuccessCount] = useState(0);

  // The team's brief for Michael — extra instructions layered on top of his
  // own rules. Saved with the project so it survives a reload.
  const [brief, setBrief] = useState('');
  const [briefOpen, setBriefOpen] = useState(true);
  const [briefStatus, setBriefStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);

  const [hasGenerated, setHasGenerated] = useState(false);
  // Guards against a stale GET overwriting what the user just typed.
  const briefLoaded = useRef(false);

  // Load the saved brief on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/michael/${projectId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setBrief(typeof data.prompt === 'string' ? data.prompt : '');
      } catch {
        // A failed load is not worth an error banner — the user can still
        // type a brief and generate; it just will not have been saved yet.
      } finally {
        briefLoaded.current = true;
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  /** Persist the brief. Called on blur, so we are not saving per keystroke. */
  async function persistBrief() {
    if (briefStatus === 'saving') return;
    setBriefStatus('saving');
    try {
      const res = await fetch(`/api/michael/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: brief }),
      });
      if (!res.ok) throw new Error('save failed');
      setBriefStatus('saved');
      window.setTimeout(() => setBriefStatus('idle'), 1800);
    } catch {
      setBriefStatus('error');
    }
  }

  async function handleGenerate() {
    if (loading) return;
    setError('');
    setSuccessCount(0);
    setLoading(true);
    try {
      const res = await fetch(`/api/michael/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate tasks');
      setProposals(data.tasks || []);
      setSummary(data.message || '');
      setRepoInfo(data.repo ?? null);
      setHasGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function updateProposal(clientId: string, patch: Partial<ProposedTask>) {
    setProposals((prev) =>
      prev.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p))
    );
  }

  function deleteProposal(clientId: string) {
    setProposals((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  function reset() {
    setProposals([]);
    setSummary('');
    setError('');
    setSuccessCount(0);
    setRepoInfo(null);
    setHasGenerated(false);
  }

  async function handleCreate() {
    if (creating) return;
    const valid = proposals.filter((p) => p.title.trim().length > 0);
    if (valid.length === 0) {
      setError('Add at least one task with a title before creating.');
      return;
    }
    setError('');
    setCreating(true);
    try {
      const res = await fetch(`/api/michael/${projectId}/create-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: valid.map((p) => ({
            title: p.title.trim(),
            description: p.description.trim(),
            priority: p.priority,
            assignee_id: p.suggestedAssigneeId || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create tasks');

      setSuccessCount(data.count ?? valid.length);
      setProposals([]);
      setSummary('');
      onTasksCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  const validCount = proposals.filter((p) => p.title.trim().length > 0).length;

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Michael
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              AI Task Planner · &ldquo;That&apos;s what she said&rdquo;
            </p>
          </div>
        </div>
        {hasGenerated && !loading && successCount === 0 && (
          <button
            onClick={reset}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* -------------------------------------------------------------------
          The team's brief — extra instructions for Michael.
          Always reachable so it can be tweaked and the plan regenerated.
         ------------------------------------------------------------------- */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setBriefOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            Extra instructions for Michael
            {brief.trim() && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                set
              </span>
            )}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${briefOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {briefOpen && (
          <div className="px-5 pb-4 space-y-2">
            <textarea
              value={brief}
              onChange={(e) => {
                setBrief(e.target.value);
                if (briefStatus === 'error') setBriefStatus('idle');
              }}
              onBlur={persistBrief}
              placeholder={BRIEF_PLACEHOLDER}
              rows={4}
              maxLength={4000}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 outline-none resize-y"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Saved with the project. Michael reads it alongside the repo and
                your team. {brief.length}/4000
              </p>
              <span className="text-xs shrink-0 flex items-center gap-1">
                {briefStatus === 'saving' && (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                    <span className="text-gray-400">Saving…</span>
                  </>
                )}
                {briefStatus === 'saved' && (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
                  </>
                )}
                {briefStatus === 'error' && (
                  <span className="text-red-600 dark:text-red-400">
                    Could not save
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Pre-generation prompt */}
      {!hasGenerated && (
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Michael will read the project{' '}
            <span className="font-semibold">{projectName}</span>, the
            description
            {hasRepo ? ', the actual code in your repo' : ' (no repo linked yet)'},
            and your team — then propose a starter set of tasks for you to
            review.
          </p>

          {!projectDescription?.trim() && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Project description is empty. Add one in the Jim tab first so
                Michael has more to work with.
              </span>
            </div>
          )}

          {teamMembers.length === 0 && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                No team members yet — tasks will be proposed unassigned.
              </span>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Michael is reading your project…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate tasks with Michael
              </>
            )}
          </button>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* Loading shimmer */}
      {loading && (
        <div className="p-5 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Reading the repo and breaking the project into tasks…</span>
          </div>
        </div>
      )}

      {/* Post-generation: editable proposals */}
      {hasGenerated && !loading && (
        <div className="p-5 space-y-4">
          {successCount > 0 && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Created {successCount} task{successCount !== 1 ? 's' : ''} on the
              board. They&apos;re in the To Do column.
            </div>
          )}

          {/* What Michael actually managed to read. */}
          {repoInfo && repoInfo.filesRead > 0 && (
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-300 flex items-start gap-2">
              <GitBranch className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Michael read <strong>{repoInfo.filesRead}</strong> of{' '}
                <strong>{repoInfo.totalFiles}</strong> source files from{' '}
                <strong>{repoInfo.repoFullName}</strong>
                {repoInfo.defaultBranch ? ` (${repoInfo.defaultBranch})` : ''}
                {repoInfo.languages && repoInfo.languages !== '(unknown)'
                  ? ` — ${repoInfo.languages}`
                  : ''}
                . His tasks are grounded in that code.
              </span>
            </div>
          )}

          {/* Anything that limited what he could see. */}
          {repoInfo && repoInfo.notes.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="space-y-1">
                {repoInfo.notes.map((n, i) => (
                  <span key={i} className="block">
                    {n}
                  </span>
                ))}
              </span>
            </div>
          )}

          {summary && successCount === 0 && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900 dark:text-amber-100 whitespace-pre-wrap">
                  {summary}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {proposals.length === 0 && successCount === 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center py-6">
              No proposals — adjust the instructions above and try again.
            </p>
          )}

          {proposals.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Review &amp; tweak ({proposals.length} proposed
                  {proposals.length !== 1 ? 's' : ''})
                </h4>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {validCount} ready to create
                </span>
              </div>

              <div className="space-y-3">
                {proposals.map((p, idx) => (
                  <ProposalRow
                    key={p.clientId}
                    proposal={p}
                    index={idx}
                    teamMembers={teamMembers}
                    onChange={(patch) => updateProposal(p.clientId, patch)}
                    onDelete={() => deleteProposal(p.clientId)}
                  />
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={handleCreate}
                  disabled={creating || validCount === 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create {validCount} task{validCount !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Regenerate
                </button>
                <button
                  onClick={reset}
                  disabled={creating}
                  className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One editable proposal row
// ---------------------------------------------------------------------------
function ProposalRow({
  proposal,
  index,
  teamMembers,
  onChange,
  onDelete,
}: {
  proposal: ProposedTask;
  index: number;
  teamMembers: TeamMember[];
  onChange: (patch: Partial<ProposedTask>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          #{index + 1}
        </span>
        <button
          onClick={onDelete}
          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          title="Remove this task"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <input
        type="text"
        value={proposal.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Task title"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 outline-none"
      />

      <textarea
        value={proposal.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Describe what needs to be done…"
        rows={2}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 outline-none resize-none"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={proposal.suggestedAssigneeId ?? ''}
          onChange={(e) =>
            onChange({ suggestedAssigneeId: e.target.value || undefined })
          }
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 outline-none"
        >
          <option value="">Unassigned</option>
          {teamMembers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.specialization?.trim() ? `${m.name} — ${m.specialization.trim()}` : m.name}
            </option>
          ))}
        </select>

        <select
          value={proposal.priority}
          onChange={(e) =>
            onChange({ priority: e.target.value as TaskPriority })
          }
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 outline-none"
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {proposal.rationale && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">
          {proposal.rationale}
        </p>
      )}

      <span
        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityColor(proposal.priority)}`}
      >
        {proposal.priority}
      </span>
    </div>
  );
}
