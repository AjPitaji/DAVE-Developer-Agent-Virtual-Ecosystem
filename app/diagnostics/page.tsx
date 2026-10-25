'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, XCircle, AlertCircle, RefreshCw } from 'lucide-react'
import Link from 'next/link'

interface TableStatus {
  name: string
  status: 'exists' | 'missing' | 'rls_active' | 'error'
  message?: string
}

export default function DiagnosticsPage() {
  const supabase = createClient()

  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [tables, setTables] = useState<TableStatus[]>([])
  const [rlsPolicies, setRlsPolicies] = useState<{ name: string; enabled: boolean }[]>([])
  const [loading, setLoading] = useState(false)

  const TABLES_TO_CHECK = [
    'profiles',
    'teams',
    'team_members',
    'projects',
    'project_members',
    'boards',
    'columns',
    'tasks',
    'labels',
    'task_labels',
    'task_comments',
    'workflows',
    'workflow_stages',
    'approval_requests',
    'notifications',
  ]

  const runDiagnostics = async () => {
    setLoading(true)
    setConnectionStatus('testing')
    setConnectionMessage('Testing connection...')
    setTables([])
    setRlsPolicies([])

    try {
      // Test basic connection
      const { error: connectionError } = await supabase
        .from('profiles')
        .select('count', { count: 'exact', head: true })

      if (connectionError && connectionError.code !== 'PGRST301' && connectionError.code !== '42P01') {
        setConnectionStatus('error')
        setConnectionMessage(`Connection failed: ${connectionError.message}`)
      } else {
        setConnectionStatus('connected')
        setConnectionMessage('Connected to Supabase successfully!')
      }

      // Check each table
      const tableResults: TableStatus[] = []
      const rlsResults: { name: string; enabled: boolean }[] = []

      for (const table of TABLES_TO_CHECK) {
        try {
          const { error: selectError } = await supabase.from(table).select('*').limit(1)

          if (selectError) {
            if (selectError.code === '42P01') {
              // Table doesn't exist
              tableResults.push({
                name: table,
                status: 'missing',
                message: 'Table does not exist',
              })
            } else if (
              selectError.code === 'PGRST301' ||
              selectError.message?.includes('violates row-level security')
            ) {
              // Table exists, RLS is active
              tableResults.push({
                name: table,
                status: 'rls_active',
                message: 'Table exists with RLS enabled',
              })
              rlsResults.push({ name: table, enabled: true })
            } else {
              tableResults.push({
                name: table,
                status: 'error',
                message: selectError.message || 'Unknown error',
              })
            }
          } else {
            tableResults.push({
              name: table,
              status: 'exists',
              message: 'Table exists and accessible',
            })
          }
        } catch (err: any) {
          tableResults.push({
            name: table,
            status: 'error',
            message: err.message || 'Check failed',
          })
        }
      }

      setTables(tableResults)
      setRlsPolicies(rlsResults)
    } catch (err: any) {
      setConnectionStatus('error')
      setConnectionMessage(`Unexpected error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runDiagnostics()
  }, [])

  const getStatusIcon = (status: TableStatus['status']) => {
    switch (status) {
      case 'exists':
      case 'rls_active':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'missing':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
    }
  }

  const getStatusBadge = (status: TableStatus['status']) => {
    switch (status) {
      case 'exists':
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      case 'rls_active':
        return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      case 'missing':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      case 'error':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    }
  }

  const missingTables = tables.filter((t) => t.status === 'missing')
  const healthyTables = tables.filter((t) => t.status === 'exists' || t.status === 'rls_active')

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-blue-900/20 p-4">
      <div className="max-w-5xl mx-auto pt-8 pb-16">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6 transition-colors text-sm"
          >
            ← Back to Dashboard
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                DAVE Database Diagnostics
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Checking your Supabase database tables, RLS policies, and triggers
              </p>
            </div>
            <button
              onClick={runDiagnostics}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Re-run Diagnostics
                </>
              )}
            </button>
          </div>
        </div>

        {/* Connection Status */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-700 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Supabase Connection
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {process.env.NEXT_PUBLIC_SUPABASE_URL}
              </p>
            </div>
            <div
              className={`text-sm font-medium px-4 py-2 rounded-lg ${
                connectionStatus === 'connected'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : connectionStatus === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {connectionMessage}
            </div>
          </div>
        </div>

        {/* Summary */}
        {tables.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                {healthyTables.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Tables Ready</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="text-3xl font-bold text-red-600 dark:text-red-400 mb-1">
                {missingTables.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Tables Missing</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-1">
                {rlsPolicies.length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">RLS Policies Active</div>
            </div>
          </div>
        )}

        {/* Table Status */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-700 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Table Status Checks
          </h2>
          {tables.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {loading ? 'Checking tables...' : 'Click "Run Diagnostics" to check your database tables'}
            </div>
          ) : (
            <div className="space-y-2">
              {tables.map((table) => (
                <div
                  key={table.name}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(table.status)}
                    <div>
                      <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                        {table.name}
                      </span>
                      {table.message && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{table.message}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${getStatusBadge(
                      table.status
                    )}`}
                  >
                    {table.status === 'rls_active' ? 'RLS Active' : table.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error Explanation */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-100 mb-3">
            The Cause of Your Error
          </h3>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
            The <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">new row violates row-level security policy for table "teams"</code> error occurs when:
          </p>
          <ul className="list-disc list-inside text-sm text-amber-800 dark:text-amber-200 space-y-1 mb-4">
            <li>You try to create a team, but the <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">handle_new_team()</code> trigger is missing</li>
            <li>The trigger should automatically add you to <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">team_members</code> with <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">security definer</code> privileges</li>
            <li>Without the trigger, the RLS policy blocks the insert because it expects you to already be an owner</li>
          </ul>
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-amber-300 dark:border-amber-700">
            <span className="font-semibold text-xs text-amber-900 dark:text-amber-100 uppercase tracking-wider block mb-2">
              Fix Instructions:
            </span>
            <ol className="list-decimal list-inside space-y-2 text-sm text-amber-800 dark:text-amber-200">
              <li>
                Open your Supabase Dashboard:{' '}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100"
                >
                  supabase.com/dashboard
                </a>
              </li>
              <li>Select your project (vugzkbjuhuxyalxdyorm)</li>
              <li>Click "SQL Editor" in the left sidebar</li>
              <li>Create a "New Query"</li>
              <li>
                Copy and paste the entire contents of{' '}
                <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">
                  supabase/migrations/20261003000000_initial_schema.sql
                </code>
              </li>
              <li>Click "Run" to execute the migration</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
