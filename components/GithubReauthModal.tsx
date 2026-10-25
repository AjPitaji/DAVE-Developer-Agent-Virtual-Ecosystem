'use client';

import { useEffect, useState } from 'react';
import GithubIcon from '@/components/GithubIcon';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import {
  cancelRetry,
  GithubReauthPayload,
  triggerReauth,
} from '@/lib/github/client';

interface GithubReauthModalProps {
  /**
   * When set, the modal is shown. Pass `null` to hide. The parent owns
   * the visibility state so it can clear it after the user clicks the
   * primary CTA (which navigates away).
   */
  payload: GithubReauthPayload | null;
  /**
   * Short label of the action that failed — used in the modal copy
   * ("Reconnect to continue <action>"). Falls back to a generic phrase.
   */
  actionLabel?: string;
  /**
   * Where to send the user after re-auth. Defaults to the current path.
   */
  returnTo?: string;
  /** Close handler — fires when the user clicks the X or "Cancel". */
  onDismiss: () => void;
}

/**
 * Modal that fires when a GitHub-backed action fails with
 * `GITHUB_REAUTH_REQUIRED`. The primary CTA starts the OAuth round trip
 * via `window.location` so the user lands back on `returnTo` (the same
 * project page) once GitHub has issued a fresh token. Cancel just hides
 * the modal without navigating.
 */
export function GithubReauthModal({
  payload,
  actionLabel = 'this action',
  returnTo,
  onDismiss,
}: GithubReauthModalProps) {
  const [busy, setBusy] = useState(false);

  // Allow Esc to dismiss when the modal is open. We add the listener
  // imperatively so it tears down on unmount even if the parent keeps
  // re-rendering with new payloads.
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, busy, onDismiss]);

  if (!payload) return null;

  const handleReconnect = () => {
    setBusy(true);
    triggerReauth({
      returnTo,
      action: actionLabel,
    });
    // triggerReauth triggers a full-page redirect — no need to do
    // anything else. We *do* keep the busy state so the button doesn't
    // flash back to enabled during the few hundred ms before navigation.
  };

  const handleCancel = () => {
    // The user explicitly chose not to reconnect. Clear any pending
    // retry so a phantom replay doesn't fire on the next mount.
    cancelRetry();
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-reauth-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 p-6">
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="github-reauth-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              GitHub connection expired
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {payload.error}
            </p>
            {actionLabel && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Reconnect your GitHub account to continue <strong>{actionLabel}</strong>.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReconnect}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Redirecting…
              </>
            ) : (
              <>
                <GithubIcon className="w-4 h-4" />
                Reconnect GitHub
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}