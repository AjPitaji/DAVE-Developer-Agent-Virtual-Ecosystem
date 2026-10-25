'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import GithubIcon from '@/components/GithubIcon'
import { GithubReauthModal } from '@/components/GithubReauthModal'
import {
  GithubReauthPayload,
  consumeRetry,
  triggerReauth,
} from '@/lib/github/client'
import {
  ArrowLeft,
  Loader2,
  Settings,
  User,
  Briefcase,
  Save,
  Check,
  X,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'

// GitHub handle rules: alphanumeric or single hyphens, max 39 chars,
// cannot start or end with a hyphen.
const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

interface GithubStatus {
  connected: boolean
  valid: boolean
  githubUsername: string | null
  authorizeUrl: string
}

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [userId, setUserId] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const [name, setName] = useState('')
  const [githubUsername, setGithubUsername] = useState('')
  const [githubConnected, setGithubConnected] = useState(false)
  const [githubValid, setGithubValid] = useState<boolean | null>(null)
  const [authorReauth, setAuthorReauth] = useState<GithubReauthPayload | null>(null)
  const [checkingToken, setCheckingToken] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  /**
   * Developer-declared specialty — the signal Michael uses to route work and
   * team owners use to review a candidate.
   */
  const [specialization, setSpecialization] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    loadProfile()
    checkGithubStatus()
  }, [])

  // If we got bounced back here from the OAuth re-auth flow and a retry
  // was queued, show a friendly "you're back" toast. We don't auto-run
  // anything because the only thing we *can* auto-run from Settings is
  // a token re-check, which we already kicked off above.
  useEffect(() => {
    const pending = consumeRetry()
    if (pending) {
      setSuccessMsg('GitHub reconnected. Your token is now active.')
      // Re-validate immediately so the UI flips from "invalid" to
      // "valid" without the user needing to refresh.
      checkGithubStatus()
    }
  }, [])

  const loadProfile = async () => {
    try {
      setLoading(true)
      setError('')

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUserId(user.id)
      setEmail(user.email || '')

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('name, github_username, github_token, specialization')
        .eq('id', user.id)
        .single()

      if (profileError) throw profileError

      setName(data?.name || '')
      setGithubUsername(data?.github_username || '')
      setGithubConnected(!!data?.github_token)
      setSpecialization(data?.specialization || '')
    } catch (err: any) {
      setError(err.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Ask the server to ping GitHub with the stored token. Cheap (one
   * `GET /user` call) and tells us whether the token is still accepted.
   * We use this to surface a "reconnect" hint *before* the user tries
   * to do something that would 401.
   */
  const checkGithubStatus = async () => {
    setCheckingToken(true)
    try {
      const res = await fetch(`/api/auth/github/status?return_to=${encodeURIComponent('/settings')}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const status = (await res.json()) as GithubStatus
      setGithubConnected(status.connected)
      setGithubValid(status.valid)
      setGithubUsername(status.githubUsername ?? '')
    } catch {
      // Network blip — don't pester the user; the next action that
      // touches GitHub will retry.
    } finally {
      setCheckingToken(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccessMsg('')

    try {
      const cleaned = githubUsername.trim().replace(/^@+/, '')

      if (cleaned && !HANDLE_RE.test(cleaned)) {
        throw new Error(
          'That does not look like a valid GitHub username. Use letters, numbers and single hyphens.'
        )
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          name: name.trim(),
          github_username: cleaned || null,
          specialization: specialization.trim() || null,
        })
        .eq('id', userId)

      if (updateError) throw updateError

      setGithubUsername(cleaned)
      setSpecialization(specialization.trim())
      setSuccessMsg('Profile updated.')

      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleConnectGithub = async () => {
    setError('')
    setSuccessMsg('')
    // Always go through the regular OAuth flow — even when we *think*
    // the token is invalid. authorize() will set a fresh `state` and
    // overwrite the stored token on success.
    router.push('/api/auth/github/authorize?return_to=' + encodeURIComponent('/settings'))
  }

  /**
   * One-click re-auth from the "connection expired" banner. Same code
   * path as a fresh connect — we just present it differently in the UI
   * so the user knows what's happening.
   */
  const handleReauthGithub = () => {
    setError('')
    setSuccessMsg('')
    triggerReauth({
      returnTo: '/settings',
      action: 'using GitHub in DAVE',
    })
  }

  const handleDisconnectGithub = async () => {
    setDisconnecting(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/auth/github/disconnect', {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to disconnect GitHub')
      }

      setGithubConnected(false)
      setGithubValid(false)
      setSuccessMsg('GitHub disconnected.')
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect GitHub')
    } finally {
      setDisconnecting(false)
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    const oauthError = url.searchParams.get('github_oauth_error')
    const oauthSuccess = url.searchParams.get('github_oauth')

    if (oauthError) {
      setError(oauthError)
      url.searchParams.delete('github_oauth_error')
      window.history.replaceState({}, '', url.toString())
    }

    if (oauthSuccess === 'connected') {
      setGithubConnected(true)
      setGithubValid(true)
      setSuccessMsg('GitHub connected successfully.')
      url.searchParams.delete('github_oauth')
      window.history.replaceState({}, '', url.toString())
      // Re-validate so we don't keep a stale "invalid" flag from a prior
      // session.
      checkGithubStatus()
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    )
  }

  const githubUrl = githubUsername ? `https://github.com/${githubUsername}` : null
  const handleLooksValid = !githubUsername.trim() || HANDLE_RE.test(githubUsername.trim().replace(/^@+/, ''))

  // Render the connection state in one of three flavors:
  //   - Not connected            → "Connect" button
  //   - Connected + valid       → green badge + Disconnect
  //   - Connected but invalid   → amber banner + Reconnect button
  // This drives both the inline badge and the helper text below.
  const showInvalidState = githubConnected && githubValid === false

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-2xl mx-auto pt-8 pb-16">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl mb-4 shadow-lg shadow-purple-500/50">
            <Settings className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Your Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Update how you appear to teammates and link your GitHub work
          </p>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl flex items-center gap-2 text-sm">
            <X className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 shrink-0 text-emerald-500" />
            {successMsg}
          </div>
        )}

        {/* GitHub connection invalid banner */}
        {showInvalidState && (
          <div
            role="alert"
            className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-xl"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">
                  GitHub connection is no longer valid
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  The token DAVE stored is being rejected by GitHub. This
                  usually happens when you revoke the connection from GitHub or
                  rotate your password. Dwight, Jim, repo creation, and PR
                  linking will fail until you reconnect.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleReauthGithub}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
                  >
                    <GithubIcon className="w-3.5 h-3.5" />
                    Reconnect GitHub
                  </button>
                  <button
                    type="button"
                    onClick={checkGithubStatus}
                    disabled={checkingToken}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {checkingToken ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Re-check
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-100 dark:border-gray-700">
          <form onSubmit={handleSave} className="space-y-6">
            {/* Email (read only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                readOnly
                disabled
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Your sign-in email cannot be changed here.
              </p>
            </div>

            {/* Display name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2"
              >
                <User className="w-4 h-4 text-purple-500" />
                Display Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Alex Rivera"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
              />
            </div>

            {/* Specialization */}
            <div>
              <label
                htmlFor="specialization"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2"
              >
                <Briefcase className="w-4 h-4 text-purple-500" />
                Your Specialization
              </label>
              <input
                id="specialization"
                type="text"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                maxLength={160}
                placeholder="e.g. Frontend — React, Next.js, Tailwind"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                Team owners see this when you request to join a team, and Michael
                uses it to assign you tasks that match what you actually do.
              </p>
            </div>

            {/* GitHub username */}
            <div>
              <label
                htmlFor="github"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2"
              >
                <GithubIcon className="w-4 h-4 text-gray-700 dark:text-gray-200" />
                GitHub Username
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                  github.com/
                </span>
                <input
                  id="github"
                  type="text"
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  placeholder="your-username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`w-full pl-[7.5rem] pr-4 py-3 rounded-xl border bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:border-transparent transition-all outline-none ${
                    handleLooksValid
                      ? 'border-gray-300 dark:border-gray-600 focus:ring-purple-500'
                      : 'border-red-400 dark:border-red-600 focus:ring-red-500'
                  }`}
                />
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <p
                  className={`text-xs ${
                    handleLooksValid
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'text-red-600 dark:text-red-400 font-medium'
                  }`}
                >
                  {handleLooksValid
                    ? 'Optional. Lets teammates open your profile and attach repos to your projects.'
                    : 'Invalid username. Letters, numbers and single hyphens only.'}
                </p>
                {githubUrl && (
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline shrink-0"
                  >
                    Preview
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* GitHub connection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <GithubIcon className="w-4 h-4 text-gray-700 dark:text-gray-200" />
                GitHub Connection
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {githubConnected && !showInvalidState ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Connected
                    </span>
                    <button
                      type="button"
                      onClick={handleDisconnectGithub}
                      disabled={disconnecting}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                    <button
                      type="button"
                      onClick={checkGithubStatus}
                      disabled={checkingToken}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      {checkingToken ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Verify
                    </button>
                  </>
                ) : showInvalidState ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Token invalid
                    </span>
                    <button
                      type="button"
                      onClick={handleReauthGithub}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white dark:text-gray-900 text-white text-xs font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                    >
                      <GithubIcon className="w-3.5 h-3.5" />
                      Reconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectGithub}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 dark:bg-white dark:text-gray-900 text-white text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                  >
                    <GithubIcon className="w-4 h-4" />
                    Connect GitHub
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {showInvalidState
                  ? 'Your stored token was revoked or expired. Reconnect to keep using Dwight, Jim, and repo tools.'
                  : githubConnected
                  ? 'DAVE can create repos on your behalf using your GitHub identity.'
                  : 'Connect your GitHub account to create repos directly from DAVE.'}
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={saving || !handleLooksValid || !name.trim()}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-purple-500/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save Changes
                </>
              )}
            </button>
          </form>
        </div>

        {/* Preview card */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-6 border border-gray-100 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            How teammates will see you
          </p>
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-purple-500/20">
              {(name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-900 dark:text-white truncate">
                {name || 'Unnamed'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{email}</p>
            </div>
            {githubUrl && (
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`@${githubUsername}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors shrink-0"
              >
                <GithubIcon className="w-4 h-4" />
                @{githubUsername}
              </a>
            )}
          </div>
          {specialization.trim() && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-medium border border-purple-500/20 dark:border-purple-500/30">
                <Briefcase className="w-3 h-3 shrink-0" />
                <span className="truncate">{specialization.trim()}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <GithubReauthModal
        payload={authorReauth}
        actionLabel="using GitHub in DAVE"
        returnTo="/settings"
        onDismiss={() => setAuthorReauth(null)}
      />
    </div>
  )
}