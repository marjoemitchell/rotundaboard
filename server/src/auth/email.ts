import { Resend } from 'resend'
import { renderEmail, type EmailContent } from '../emailLayout.js'

// No RESEND_API_KEY is required to run this app locally — password reset
// and invite emails just get logged to the console instead of sent, so the
// full flow (grab the link from the log, paste it in) is still testable
// without setting up a real provider. Set RESEND_API_KEY to actually send.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Every email is also kept in memory, independent of whether Resend is
// configured, so the e2e suite can read back an invite/reset link without
// a real inbox or scraping console output (which stops working the moment
// a real RESEND_API_KEY is set). Exposed via a dev-only route in server.ts.
type SentEmail = { to: string; subject: string; html: string; text: string | null; sentAt: number }
const sentEmails: SentEmail[] = []
const MAX_CAPTURED_EMAILS = 50

// Returns false if the email was not sent. Without RESEND_API_KEY the email
// is only written to the log. That counts as sent in local development, but
// not in production: there it is a configuration error, and callers that
// retry (scrapeHealth.ts) must try again.
export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  sentEmails.push({ to, subject, html, text: text ?? null, sentAt: Date.now() })
  if (sentEmails.length > MAX_CAPTURED_EMAILS) sentEmails.shift()

  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[email] RESEND_API_KEY is not set. Email not sent: to=${to} subject="${subject}"`)
      return false
    }
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}`)
    return true
  }
  const from = process.env.EMAIL_FROM_ADDRESS ?? 'notifications@rotundaboard.example'
  // The Resend SDK does not throw on an API-level failure (unverified
  // sender domain, restricted recipient in test mode, etc.) — it resolves
  // with { error } instead, so that has to be checked explicitly or a
  // rejected send fails completely silently.
  const { error } = await resend.emails.send({ from, to, subject, html, ...(text ? { text } : {}) })
  if (error) {
    console.error(`[email:resend] failed to send "${subject}" to ${to}: ${error.name} - ${error.message}`)
    return false
  }
  return true
}

/** Sends an email in the Rotunda Board layout (see emailLayout.ts), with a plain-text version. */
export function sendLayoutEmail(to: string, subject: string, content: EmailContent): Promise<boolean> {
  const { html, text } = renderEmail(content, subject)
  return sendEmail(to, subject, html, text)
}

export function getLastEmailTo(to: string): SentEmail | undefined {
  for (let i = sentEmails.length - 1; i >= 0; i--) {
    if (sentEmails[i].to === to) return sentEmails[i]
  }
  return undefined
}
