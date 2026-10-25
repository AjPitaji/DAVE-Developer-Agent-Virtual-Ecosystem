import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'GitHub OAuth client ID is not configured' }, { status: 500 })
  }

  const cookieStore = await cookies()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'))
  }

  const state = crypto.randomUUID()
  const maxAge = 60 * 5

  // Stash both the CSRF state *and* an optional `return_to` (where to send
  // the user after re-auth completes). We keep them in separate cookies
  // because the state cookie has to be single-use, whereas return_to is
  // safe to read until the callback deletes it.
  cookieStore.set('github_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })

  // Open the CSRF window a touch wider so a user who clicks "Reconnect"
  // mid-task can finish the GitHub consent screen even if they take a few
  // minutes to read the scopes. 10 minutes is well within typical OAuth
  // UX.
  const url = new URL(request.url)
  const returnToRaw = url.searchParams.get('return_to')
  // Whitelist to relative URLs to avoid open-redirect abuse. We accept
  // paths only (no protocol, no host). Anything else is dropped silently
  // and the user lands on the Settings page after re-auth.
  const safeReturnTo =
    returnToRaw && returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : null
  if (safeReturnTo) {
    cookieStore.set('github_oauth_return_to', safeReturnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/auth/github/callback`,
    scope: 'repo',
    state,
    allow_signup: 'true',
  })

  return NextResponse.redirect(new URL(`https://github.com/login/oauth/authorize?${params.toString()}`, 'https://github.com'))
}