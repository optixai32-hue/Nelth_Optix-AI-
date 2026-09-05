import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — Nelth-IA',
  description:
    'How Nelth-IA collects, uses, stores and deletes your data, including Google, GitHub and Notion integration data.'
}

const CONTACT_EMAIL = 'optixai32@gmail.com'

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to Nelth-IA
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Effective date: September 5, 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold">1. Overview</h2>
          <p className="mt-2">
            Nelth-IA (&quot;the Service&quot;) is an AI-powered answer engine.
            You can optionally connect third-party accounts (Google, GitHub,
            Notion) so the assistant can read data you explicitly ask about.
            This policy explains what data is accessed, why, how it is stored,
            and how you can delete it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            2. Data accessed through integrations
          </h2>
          <p className="mt-2">
            Connections are strictly <strong>read-only</strong> and only used
            to answer your own requests in the chat:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>Google</strong> (Drive, Gmail, Calendar): file names and
              content you reference, email messages you ask about, and calendar
              events — scopes{' '}
              <code>drive.readonly</code>, <code>gmail.readonly</code>,{' '}
              <code>calendar.readonly</code>, <code>userinfo.email</code>.
            </li>
            <li>
              <strong>GitHub</strong>: repositories and files you reference —
              scope <code>repo</code> (read-only usage).
            </li>
            <li>
              <strong>Notion</strong>: pages and databases you explicitly share
              with the integration.
            </li>
          </ul>
          <p className="mt-2">
            The Service never modifies, deletes, sends, or shares your
            third-party content on your behalf.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            3. How your data is used
          </h2>
          <p className="mt-2">
            Integration data is used only to fulfil your requests (for example,
            summarizing a document or finding an email). Query content may be
            transmitted to the AI model provider selected in the app in order
            to generate the answer. Account data (email address) is used for
            sign-in via Firebase Authentication.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            4. Storage and security
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              OAuth tokens are encrypted with AES-256-GCM before storage and
              kept in a server-side vault (Firestore). The encryption key lives
              only in server environment variables.
            </li>
            <li>
              Access tokens are short-lived; expired tokens are refreshed
              server-side using the stored refresh token.
            </li>
            <li>
              Connections are scoped to your own user account and are never
              exposed to other users.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            5. Sharing and sale of data
          </h2>
          <p className="mt-2">
            We do not sell your personal data, we do not use it for
            advertising, and we do not share it with third parties except (a)
            the AI model providers needed to answer your queries, (b) hosting
            and infrastructure providers (Vercel, Firebase/Google Cloud), and
            (c) when required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            6. Deletion and control
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              Use the <strong>Disconnect</strong> button on any connector to
              immediately delete its stored OAuth tokens.
            </li>
            <li>
              You can also revoke access at any time from your provider&apos;s
              settings (e.g. Google Account → Security → Third-party access).
            </li>
            <li>
              To request deletion of your account data, email {CONTACT_EMAIL}.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Children</h2>
          <p className="mt-2">
            The Service is not directed to children under 13, and we do not
            knowingly collect their data.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Changes</h2>
          <p className="mt-2">
            If this policy changes materially, the effective date above will be
            updated. Continued use of the Service after changes means you
            accept the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Contact</h2>
          <p className="mt-2">
            Questions about this policy: <strong>{CONTACT_EMAIL}</strong>.
          </p>
        </section>
      </div>
    </main>
  )
}
