import { Resend } from 'resend'

// No RESEND_API_KEY is required to run this app locally — password reset
// and invite emails just get logged to the console instead of sent, so the
// full flow (grab the link from the log, paste it in) is still testable
// without setting up a real provider. Set RESEND_API_KEY to actually send.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

// Every email is also kept in memory, independent of whether Resend is
// configured, so the e2e suite can read back an invite/reset link without
// a real inbox or scraping console output (which stops working the moment
// a real RESEND_API_KEY is set). Exposed via a dev-only route in server.ts.
type SentEmail = { to: string; subject: string; html: string; sentAt: number }
const sentEmails: SentEmail[] = []
const MAX_CAPTURED_EMAILS = 50

export async function sendEmail(to: string, subject: string, html: string) {
  sentEmails.push({ to, subject, html, sentAt: Date.now() })
  if (sentEmails.length > MAX_CAPTURED_EMAILS) sentEmails.shift()

  if (!resend) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}`)
    return
  }
  const from = process.env.EMAIL_FROM_ADDRESS ?? 'notifications@rotundaboard.example'
  // The Resend SDK does not throw on an API-level failure (unverified
  // sender domain, restricted recipient in test mode, etc.) — it resolves
  // with { error } instead, so that has to be checked explicitly or a
  // rejected send fails completely silently.
  const { error } = await resend.emails.send({ from, to, subject, html })
  if (error) {
    console.error(`[email:resend] failed to send "${subject}" to ${to}: ${error.name} - ${error.message}`)
  }
}

export function getLastEmailTo(to: string): SentEmail | undefined {
  for (let i = sentEmails.length - 1; i >= 0; i--) {
    if (sentEmails[i].to === to) return sentEmails[i]
  }
  return undefined
}
