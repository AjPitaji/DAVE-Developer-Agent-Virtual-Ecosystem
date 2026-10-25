'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Loader2,
  FileCode,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import GithubIcon from '@/components/GithubIcon';
import { GithubReauthModal } from '@/components/GithubReauthModal';
import {
  GithubReauthPayload,
  extractGithubReauth,
} from '@/lib/github/client';

interface GeneratedFile {
  path: string;
  content: string;
}

interface PushResult {
  path: string;
  success: boolean;
  error?: string;
  sha?: string;
}

interface InitResult {
  message: string;
  files: GeneratedFile[];
  updatedTitle?: string;
  updatedDescription?: string;
  suggestedKey?: string;
  pushResults?: PushResult[];
}

interface JimPanelProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  hasRepo: boolean;
  // Existing project key, if Jim has run before. Used to default the
  // key input on subsequent re-runs.
  projectKey?: string | null;
  onDescriptionUpdate?: (newDescription: string) => void;
  onTitleUpdate?: (newTitle: string) => void;
  onKeyUpdate?: (newKey: string) => void;
}

// ---------------------------------------------------------------------------
// File preview modal
// ---------------------------------------------------------------------------
function FilePreview({
  file,
  onClose,
}: {
  file: GeneratedFile;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <p className="font-mono text-sm text-gray-600 dark:text-gray-400 truncate pr-4">
            {file.path}
          </p>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-sm font-mono text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900">
          <code>{file.content}</code>
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File list with per-file push status
// ---------------------------------------------------------------------------
function FileList({
  files,
  pushResults,
  isPushing,
  hasRepo,
  onPreview,
  onPush,
}: {
  files: GeneratedFile[];
  pushResults: PushResult[] | undefined;
  isPushing: boolean;
  hasRepo: boolean;
  onPreview: (f: GeneratedFile) => void;
  onPush: (files: GeneratedFile[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const resultMap = new Map<string, PushResult>(
    (pushResults ?? []).map((r) => [r.path, r])
  );
  const allPushed =
    !!pushResults &&
    pushResults.length > 0 &&
    pushResults.every((r) => r.success);

  return (
    <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden text-xs">
      {/* header row */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 font-medium text-gray-600 dark:text-gray-400">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {files.length} file{files.length !== 1 ? 's' : ''} generated
        </button>

        {hasRepo && !allPushed && (
          <button
            onClick={() => onPush(files)}
            disabled={isPushing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50 font-semibold"
          >
            {isPushing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <GithubIcon className="w-3 h-3" />
            )}
            {isPushing ? 'Pushing…' : 'Push to repo'}
          </button>
        )}

        {allPushed && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Pushed
          </span>
        )}

        {!hasRepo && (
          <span className="text-amber-600 dark:text-amber-400">
            Link a GitHub repo to push
          </span>
        )}
      </div>

      {/* file rows */}
      {expanded && (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {files.map((f, i) => {
            const result = resultMap.get(f.path);
            return (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-gray-900"
              >
                <button
                  onClick={() => onPreview(f)}
                  className="font-mono text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors truncate max-w-[200px]"
                >
                  {f.path}
                </button>
                <span>
                  {result?.success && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  {result && !result.success && (
                    <span
                      className="text-red-500"
                      title={result.error}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel — form-based "Initialize Project with Jim"
// ---------------------------------------------------------------------------
export function JimPanel({
  projectId,
  projectName,
  projectDescription,
  hasRepo,
  projectKey,
  onDescriptionUpdate,
  onTitleUpdate,
  onKeyUpdate,
}: JimPanelProps) {
  const [title, setTitle] = useState(projectName);
  const [description, setDescription] = useState(projectDescription);
  // The project key is editable on the form. Pre-fill with the project's
  // existing key if Jim has already run, otherwise empty so the user
  // sees Jim's suggestion appear after the first run.
  const [key, setKey] = useState(projectKey ?? '');
  // Optional extra instructions for Jim — e.g. "use TypeScript + Tailwind",
  // "this is a CLI, not a web app". Sent alongside the description. These
  // apply to the current run only; they're never stored.
  const [instructions, setInstructions] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InitResult | null>(null);
  const [showFilePreview, setShowFilePreview] = useState<GeneratedFile | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState('');
  // GitHub re-auth modal — shown when the push endpoint (or initialize
  // endpoint, if it ever needs GitHub) reports the stored token is bad.
  const [reauthPayload, setReauthPayload] = useState<GithubReauthPayload | null>(null);

  // Keep the form in sync if the parent reloads the project (e.g. on tab switch
  // or after the user edits title/description elsewhere). Only sync when we're
  // not actively initializing so we don't clobber the user's in-progress edits.
  const initializedTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (initialized && initializedTitleRef.current === projectName) return;
    setTitle(projectName);
    setDescription(projectDescription);
    if (projectKey) setKey(projectKey);
  }, [projectName, projectDescription, projectKey, loading, initialized]);

  // ---- API helpers --------------------------------------------------------

  async function handleInitialize(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedTitle) {
      setError('Please give your project a title.');
      return;
    }
    if (!trimmedDescription) {
      setError('Please add a description so Jim knows what to scaffold.');
      return;
    }

    setError('');
    setPushError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/jim/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enhance-and-init',
          name: trimmedTitle,
          description: trimmedDescription,
          // Optional override of Jim's suggested key. Empty string =
          // "let Jim pick / keep whatever's in the DB".
          key: key.trim(),
          // Optional extra instructions for Jim. Empty string = none.
          extraPrompt: trimmedInstructions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Detect the reauth payload (same shape the server returns from
        // the push endpoint) so we don't dump a generic error into the
        // panel — instead, show the modal so the user can re-auth in
        // one click.
        const reauth = extractGithubReauth(data);
        if (reauth) {
          setReauthPayload(reauth);
          throw new Error(reauth.error);
        }
        throw new Error(data.error || 'Request failed');
      }

      const enhancedTitle: string = data.updatedTitle || trimmedTitle;
      const enhancedDescription: string = data.updatedDescription || trimmedDescription;
      const chosenKey: string = data.suggestedKey || projectKey || '';

      // Persist the enhanced values in the parent so the page header updates
      if (enhancedTitle && enhancedTitle !== projectName) {
        onTitleUpdate?.(enhancedTitle);
      }
      if (enhancedDescription && enhancedDescription !== projectDescription) {
        onDescriptionUpdate?.(enhancedDescription);
      }
      if (chosenKey && chosenKey !== key) {
        setKey(chosenKey);
        if (chosenKey !== (projectKey ?? '')) {
          onKeyUpdate?.(chosenKey);
        }
      } else if (chosenKey && chosenKey !== (projectKey ?? '')) {
        // Server returned the existing key (because the project already
        // had one). Bubble it up so the parent stays in sync.
        onKeyUpdate?.(chosenKey);
      }

      // Reflect in the local form so the user sees what Jim produced
      setTitle(enhancedTitle);
      setDescription(enhancedDescription);
      initializedTitleRef.current = enhancedTitle;

      setResult({
        message: data.message || 'Project initialized with Jim.',
        files: data.files || [],
        suggestedKey: chosenKey,
      });
      setInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handlePush(files: GeneratedFile[]) {
    if (!result) return;
    setPushing(true);
    setPushError('');
    try {
      const res = await fetch(`/api/jim/${projectId}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          message: 'feat: scaffold project with Jim',
          branch: 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const reauth = extractGithubReauth(data);
        if (reauth) {
          setReauthPayload(reauth);
          throw new Error(reauth.error);
        }
        throw new Error(data.error || 'Push failed');
      }

      const results: PushResult[] = data.results ?? [];
      setResult((prev) => (prev ? { ...prev, pushResults: results } : prev));

      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setPushError(
          `${failed.length} file(s) failed to push: ${failed
            .map((f) => `${f.path} (${f.error})`)
            .join('; ')}`
        );
      }
    } catch (err) {
      setPushError(
        err instanceof Error ? err.message : 'Push failed'
      );
    } finally {
      setPushing(false);
    }
  }

  function handleReinitialize() {
    setInitialized(false);
    setResult(null);
    setError('');
    setPushError('');
    initializedTitleRef.current = null;
  }

  // ---- Render -------------------------------------------------------------

  const allFilesPushed =
    !!result?.pushResults &&
    result.pushResults.length > 0 &&
    result.files.length > 0 &&
    result.pushResults.length === result.files.length &&
    result.pushResults.every((r) => r.success);

  return (
    <>
      <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Jim</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                AI Code Agent
              </p>
            </div>
          </div>
          {initialized && !loading && (
            <button
              onClick={handleReinitialize}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1"
              title="Edit the title/description and re-run Jim"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Edit & Re-run
            </button>
          )}
        </div>

        {/* Form */}
        <form
          onSubmit={handleInitialize}
          className="p-5 space-y-4 border-b border-gray-200 dark:border-gray-700"
        >
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tweak the title and description, then let Jim enhance them and scaffold your repo.
          </p>

          <div>
            <label
              htmlFor="jim-title"
              className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
            >
              Project title
            </label>
            <input
              id="jim-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={loading}
              placeholder="e.g. Acme Dashboard"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="jim-description"
              className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
            >
              Description
            </label>
            <textarea
              id="jim-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              disabled={loading}
              placeholder="What does this project do? Who's it for? Any key features?"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:ring-2 focus:ring-purple-500 outline-none resize-none disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="jim-instructions"
              className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
            >
              Additional instructions for Jim
              <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                (optional)
              </span>
            </label>
            <textarea
              id="jim-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={10000}
              disabled={loading}
              placeholder="e.g. Use TypeScript + Tailwind. This is a CLI, not a web app. Use Postgres for storage."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:ring-2 focus:ring-purple-500 outline-none resize-none disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
              Steer the stack, structure, or conventions Jim should follow.
              These apply to this run only and aren&apos;t saved.
            </p>
          </div>

          <div>
            <label
              htmlFor="jim-key"
              className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
            >
              Project key
              <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                (2-4 uppercase letters, prefixes every task id)
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="jim-key"
                type="text"
                value={key}
                onChange={(e) =>
                  setKey(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 4)
                  )
                }
                disabled={loading}
                maxLength={4}
                placeholder="DV"
                className="w-24 px-3 py-2 text-sm font-mono uppercase tracking-wide rounded-lg border border-gray-300 dark:border-gray-600 bg-white text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-60"
              />
              {key && /^[A-Z0-9]{2,4}$/.test(key) && (
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  Tasks will be {key}-1, {key}-2, …
                </span>
              )}
            </div>
            {projectKey && (
              <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                Project key is set. Re-running Jim will not change it unless you edit the field above.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !title.trim() || !description.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Jim is enhancing & scaffolding…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Initialize Project with Jim
              </>
            )}
          </button>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </form>

        {/* Result */}
        {(loading || result) && (
          <div className="p-5 space-y-3">
            {loading && (
              <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span>
                  Polishing the title and description, then generating starter files…
                </span>
              </div>
            )}

            {result && (
              <>
                <div className="rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-purple-900 dark:text-purple-100 whitespace-pre-wrap">
                      {result.message}
                    </div>
                  </div>
                </div>

                {result.suggestedKey && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900 dark:text-amber-100">
                      <p>
                        Project key set to{' '}
                        <span className="font-mono font-bold text-base">
                          {result.suggestedKey}
                        </span>
                        . Tasks will be{' '}
                        <span className="font-mono">
                          {result.suggestedKey}-1
                        </span>
                        ,{' '}
                        <span className="font-mono">
                          {result.suggestedKey}-2
                        </span>
                        , … and every PR / commit message should reference one.
                      </p>
                      <p className="mt-1 text-xs opacity-90">
                        Jim also wrote{' '}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded text-[11px]">
                          .github/CONTRIBUTING.md
                        </code>
                        ,{' '}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded text-[11px]">
                          .github/PULL_REQUEST_TEMPLATE.md
                        </code>
                        , and{' '}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded text-[11px]">
                          .dave/config.json
                        </code>{' '}
                        with the convention. Push the files to publish them.
                      </p>
                    </div>
                  </div>
                )}

                {result.files && result.files.length > 0 && (
                  <FileList
                    files={result.files}
                    pushResults={result.pushResults}
                    isPushing={pushing}
                    hasRepo={hasRepo}
                    onPreview={setShowFilePreview}
                    onPush={handlePush}
                  />
                )}

                {pushError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{pushError}</span>
                  </div>
                )}

                {allFilesPushed && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    All {result.files.length} file
                    {result.files.length !== 1 ? 's' : ''} pushed to your GitHub repo.
                  </div>
                )}

                {!hasRepo && result.files.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <FileCode className="w-3.5 h-3.5" />
                    Link a GitHub repo on this page to push the generated files.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* File content modal */}
      {showFilePreview && (
        <FilePreview
          file={showFilePreview}
          onClose={() => setShowFilePreview(null)}
        />
      )}

      {/* GitHub re-auth modal. Shown when the push endpoint (or any
          future endpoint that needs GitHub) reports the stored token is
          bad. Re-auth lands the user back on this page; they can re-run
          Jim's push with one more click. */}
      <GithubReauthModal
        payload={reauthPayload}
        actionLabel="pushing Jim's scaffold to GitHub"
        returnTo={
          typeof window !== 'undefined' ? window.location.pathname : `/projects/${projectId}`
        }
        onDismiss={() => setReauthPayload(null)}
      />
    </>
  );
}