import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type RefreshedCookie = { name: string; value: string; options: CookieOptions }

/**
 * Redirect to `pathname` while carrying over any session cookies Supabase
 * refreshed during this request. Without this a redirect would drop the
 * refreshed tokens and log the user out.
 */
function redirectTo(
  request: NextRequest,
  pathname: string,
  refreshedCookies: RefreshedCookie[]
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname

  const response = NextResponse.redirect(url)
  refreshedCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const refreshedCookies: RefreshedCookie[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
            refreshedCookies.push({ name, value, options })
          })
        },
      },
    }
  )

  // CRITICAL: Use getUser() not getSession() to verify JWT signature
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // The root route is only a router: signed-in users continue to the
  // dashboard, everyone else is sent to the login page.
  if (pathname === '/') {
    return redirectTo(request, user ? '/dashboard' : '/login', refreshedCookies)
  }

  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/signup')) {
    // Redirect to login if not authenticated
    return redirectTo(request, '/login', refreshedCookies)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    // Redirect to dashboard if already authenticated
    return redirectTo(request, '/dashboard', refreshedCookies)
  }

  return supabaseResponse
}
