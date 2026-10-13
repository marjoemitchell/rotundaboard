// The shared layout for all Rotunda Board emails: change alerts, scrape
// health alerts, invitations, password resets, and the morning brief.
//
// Email clients do not support modern CSS. Gmail removes <style> blocks in
// some views, and Outlook uses the Word engine. So the layout uses tables
// and inline styles only, and no SVG (the logo is a PNG from the web app).
// Each email also gets a plain-text version, made from the same content.

export interface EmailContent {
  /** The heading at the top of the email body. */
  heading: string
  /** The body HTML. Use simple tags: p, ul, li, a, b, strong. */
  bodyHtml: string
  /** An optional main action, shown as a button. */
  button?: { label: string; url: string }
  /** Text below the body: why the person gets this email. Can contain links. */
  footerHtml?: string
  /** Short text that some inboxes show after the subject. */
  preheader?: string
}

const COLORS = {
  ink: '#0f2547',
  muted: '#5c6b80',
  faint: '#8697ab',
  paper: '#eef1f5',
  card: '#ffffff',
  border: '#d3dae4',
  accent: '#b9723d',
  navyText: '#b7c8dd',
}
const FONT = "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '')
}

function renderButton(button: { label: string; url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
<tr><td style="background:${COLORS.ink};border-radius:4px;">
<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(button.label)}</a>
</td></tr></table>`
}

/** The complete email HTML for the given content. */
export function renderEmailHtml(content: EmailContent, subject: string): string {
  const base = appBaseUrl()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.paper};">
${content.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.paper};" data-layout="rotunda-board">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="background:${COLORS.ink};padding:14px 24px;">
<a href="${base}" style="text-decoration:none;">
<img src="${base}/icon-512-dark.png" width="26" height="26" alt="" style="vertical-align:middle;border:0;">
<span style="vertical-align:middle;padding-left:8px;font-family:${FONT};font-size:17px;font-weight:600;color:#ffffff;">Rotunda</span><span style="vertical-align:middle;font-family:${FONT};font-size:17px;color:${COLORS.navyText};"> Board</span>
</a>
</td></tr>
<tr><td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-top:0;padding:26px 24px 28px;font-family:${FONT};font-size:15px;line-height:1.55;color:${COLORS.ink};">
<h1 style="margin:0 0 14px;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:600;color:${COLORS.ink};">${escapeHtml(content.heading)}</h1>
${content.bodyHtml}
${content.button ? renderButton(content.button) : ''}
</td></tr>
${
  content.footerHtml
    ? `<tr><td style="padding:16px 24px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${COLORS.muted};word-break:break-word;overflow-wrap:anywhere;">${content.footerHtml}</td></tr>`
    : ''
}
<tr><td style="padding:12px 24px 0;font-family:${FONT};font-size:12px;color:${COLORS.faint};">Rotunda Board · Montana Legislature tracking</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }

/** A readable plain-text version of simple email HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      const url = href.replace(/&amp;/g, '&')
      return text && text !== url ? `${text} (${url})` : url
    })
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, name: string) => ENTITIES[name])
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The plain-text version of the email, with the same content as the HTML. */
export function renderEmailText(content: EmailContent): string {
  const parts = ['Rotunda Board', '', content.heading, '', htmlToText(content.bodyHtml)]
  if (content.button) parts.push('', `${content.button.label}: ${content.button.url}`)
  if (content.footerHtml) parts.push('', '--', htmlToText(content.footerHtml))
  return parts.join('\n')
}

/** Both versions of an email. */
export function renderEmail(content: EmailContent, subject: string): { html: string; text: string } {
  return { html: renderEmailHtml(content, subject), text: renderEmailText(content) }
}
