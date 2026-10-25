import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errorParam = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')

    // Resolve where the user should land after this callback completes.
    // We try (in order):
    //   1. The ?return_to= URL param on the callback (if GitHub preserved
    //      it — they typically don't, but be defensive).
    //   2. The `github_oauth_return_to` cookie set by /authorize.
    //   3. /settings, the default landing page.
    //
    // For safety we whitelist relative paths; anything starting with // or
    // containing a scheme is ignored.
    const settingsUrl = new URL('/settings', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    const queryReturnTo = url.searchParams.get('return_to')
    const cookieStoreEarly = await cookies()
    const cookieReturnTo = cookieStoreEarly.get('github_oauth_return_to')?.value ?? null
    const candidate = queryReturnTo || cookieReturnTo
    const safeReturnTo =
      candidate && candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : null

    const redirectWithParams = (params: Record<string, string>) => {
      const target = new URL(
        safeReturnTo && !params.error ? safeReturnTo : settingsUrl,
        process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      )
      // Preserve existing query params on the safe target so e.g.
      // /projects/123?tab=dwight stays on the Dwight tab after re-auth.
      if (safeReturnTo && !params.error) {
        const original = new URL(safeReturnTo, process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
        original.search = url.searchParams.toString() + (url.searchParams.toString() ? '&' : '') + new URLSearchParams(params).toString()
        return NextResponse.redirect(original)
      }
      for (const [k, v] of Object.entries(params)) {
        target.searchParams.set(k, v)
      }
      return NextResponse.redirect(target)
    }

    if (errorParam) {
      cookieStoreEarly.delete('github_oauth_state')
      cookieStoreEarly.delete('github_oauth_return_to')
      return redirectWithParams({ github_oauth_error: errorDescription || errorParam })
    }

    if (!code || !state) {
      cookieStoreEarly.delete('github_oauth_state')
      cookieStoreEarly.delete('github_oauth_return_to')
      return redirectWithParams({ github_oauth_error: 'Missing authorization code or state' })
    }

    const cookieStore = await cookies()
    const storedState = cookieStore.get('github_oauth_state')?.value
    if (!storedState || storedState !== state) {
      cookieStore.delete('github_oauth_state')
      cookieStore.delete('github_oauth_return_to')
      return redirectWithParams({ github_oauth_error: 'Invalid state parameter' })
    }

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      cookieStore.delete('github_oauth_state')
      cookieStore.delete('github_oauth_return_to')
      return redirectWithParams({ github_oauth_error: 'GitHub OAuth client credentials are not configured' })
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
      }),
    })

    const tokenData = await tokenRes.json()
    if (tokenRes.ok && tokenData.access_token) {
      const cookieStore = await cookies()
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        cookieStore.delete('github_oauth_state')
        cookieStore.delete('github_oauth_return_to')
        return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'))
      }

      await supabase
        .from('profiles')
        .update({ github_token: tokenData.access_token })
        .eq('id', user.id)

      // Drain the OAuth cookies so they don't linger into a future flow.
      cookieStore.delete('github_oauth_state')
      cookieStore.delete('github_oauth_return_to')

      return redirectWithParams({ github_oauth: 'connected' })
    }

    cookieStore.delete('github_oauth_state')
    cookieStore.delete('github_oauth_return_to')
    return redirectWithParams({ github_oauth_error: tokenData.error_description || tokenData.error || 'Failed to exchange code for token' })
  } catch (err: any) {
    const cookieStore = await cookies()
    cookieStore.delete('github_oauth_state')
    cookieStore.delete('github_oauth_return_to')
    const target = new URL('/settings', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    target.searchParams.set('github_oauth_error', err.message || 'Unexpected error during GitHub OAuth')
    return NextResponse.redirect(target)
  }
}