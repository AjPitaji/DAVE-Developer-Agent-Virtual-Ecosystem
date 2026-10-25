import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Home() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Signed-in users land on the dashboard, everyone else on the login page.
  redirect(user ? '/dashboard' : '/login')
}
