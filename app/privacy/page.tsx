import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Privacy Policy for DAVE.
 *
 * ⚠️ Replace CONTACT_EMAIL with a real inbox before publishing — users need
 * a way to reach you.
 */
const CONTACT_EMAIL = 'privacy@dave.app'

export const metadata: Metadata = {
  title: 'Privacy Policy - DAVE',
  description:
    'How DAVE collects, uses, stores, and shares your personal data when you connect your GitHub account.',
  robots: { index: true, follow: true },
}

export default function PrivacyPolicyPage() {
  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <main className="flex w-full max-w-3xl flex-col gap-10 px-6 py-16 sm:px-8 sm:py-24">
        <header className="flex flex-col gap-4">
          <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            DAVE — Developer &amp; Agent Virtual Ecosystem
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Privacy Policy</h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Effective date:</span>{' '}
            24 October 2026
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">1. Who we are</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            DAVE is a project management application that uses AI agents to help small development
            teams plan work, scaffold repositories, and review code. This policy explains what
            personal information DAVE collects when you create an account and connect your GitHub
            account, how it is used, and the choices you have.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">2. Information we collect</h2>

          <h3 className="text-lg font-semibold">2.1 Account information</h3>
          <ul className="list-disc space-y-2 pl-6 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Email address</span> —{' '}
              used to create and authenticate your DAVE account.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Password</span> — your
              password is hashed and stored by our authentication provider (Supabase). DAVE never
              stores or transmits your plaintext password.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Display name and
              declared specialization</span> — optional, entered by you, used to route work to you
              and to let team owners review your profile.
            </li>
          </ul>

          <h3 className="text-lg font-semibold">2.2 GitHub data (only if you connect GitHub)</h3>
          <ul className="list-disc space-y-2 pl-6 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>Your GitHub username.</li>
            <li>
              An OAuth access token, stored server-side, used only to create repositories, open pull
              requests, and read commits for the repositories you explicitly link to a project.
            </li>
          </ul>

          <h3 className="text-lg font-semibold">2.3 Workspace content</h3>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            The content you create in DAVE — teams, projects, boards, tasks, comments, labels,
            workflows, and approvals — is stored so that the product can function.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">3. How we use your information</h2>
          <ul className="list-disc space-y-2 pl-6 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>To authenticate you, maintain your session, and operate your DAVE account.</li>
            <li>To display your identity and specialization on your profile, boards, and tasks.</li>
            <li>
              To run the AI agents that write project plans, scaffold repositories, and review code.
            </li>
            <li>To keep your GitHub connection working, and to let you disconnect it.</li>
            <li>To detect, prevent, and respond to abuse, security incidents, and legal obligations.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">4. Service providers and sub-processors</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            We do not sell your personal information. We share the minimum data needed to operate
            DAVE with the following providers:
          </p>
          <ul className="list-disc space-y-2 pl-6 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Supabase</span> —
              database hosting, authentication, and row-level access control.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">GitHub</span> — the
              identity provider and repository host for GitHub features.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">AI model providers</span>{' '}
              — third-party model APIs that process project and task content so the AI agents can
              generate plans, code, and reviews. No content is used to train third-party models.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Vercel</span> — hosting
              and deployment infrastructure for the application.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">5. Data retention</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            We keep personal information for as long as your DAVE account is active. When you
            disconnect GitHub, the stored access token is deleted immediately. When you delete your
            account, we delete your profile and workspace content, and instruct our service
            providers to delete their copies on their next deletion cycle.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">6. Your choices and rights</h2>
          <ul className="list-disc space-y-2 pl-6 leading-7 text-zinc-700 dark:text-zinc-300">
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Disconnect GitHub at
              any time</span> — use the disconnect control on the Settings page. Disconnecting
              removes the stored access token and unlinks that identity.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Edit or delete your
              data</span> — you can update your profile and delete individual projects and tasks.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Delete your account</span>{' '}
              — email us and we will delete your account and data.
            </li>
            <li>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Withdraw consent</span>{' '}
              — you may stop connecting accounts at any time. Revoking access on GitHub&apos;s side also
              prevents us from refreshing the token.
            </li>
          </ul>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Depending on where you live, you may have the right to access, correct, export, delete,
            or restrict processing of your personal information, or to object to processing. Contact
            us at{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              {CONTACT_EMAIL}
            </a>{' '}
            to exercise any of these rights.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">7. Security</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            We use OAuth 2.0 for GitHub sign-in, validate a single-use state parameter on every
            authorization to prevent cross-site request forgery, store session and OAuth state in
            httpOnly cookies, keep access tokens server-side only, and enforce row-level security
            in the database so a user can only read their own records. No method of transmission or
            storage is completely secure, so we cannot guarantee absolute security.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">8. Children&apos;s privacy</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            DAVE is a professional tool and is not directed at children. We do not knowingly
            collect personal information from anyone under the age of 16. If you believe a child
            has provided us with personal information, contact us and we will delete it.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">9. Changes to this policy</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            We may update this policy as DAVE evolves or as legal requirements change. The
            effective date at the top of this page reflects the latest revision, and material changes
            will be announced in the product before they take effect.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">10. Contact us</h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Questions about this policy or about your data? Email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-50">
            Back to DAVE
          </Link>
          <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-50">
            Settings
          </Link>
        </footer>
      </main>
    </div>
  )
}
