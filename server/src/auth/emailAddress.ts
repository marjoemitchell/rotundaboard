// Some email providers deliver one message to the same inbox for more than one
// address. This function gives one key for each inbox, so that one inbox
// cannot make more than one account. The function changes an address only
// when the provider says that the two addresses go to the same inbox:
//   - PLUS_TAG_DOMAINS deliver "name+anything@" to the inbox of "name@".
//   - DOT_BLIND_DOMAINS ignore the dots before the "@".
//   - DOMAIN_ALIASES are other names of the same mail domain.
// All other addresses keep their "+" and their dots, because at an unknown
// provider "a+b@" and "a.b@" can be the inboxes of different people.
// Examples:
//   - "Name+News@Outlook.com" becomes "name@outlook.com".
//   - "First.Last+news@googlemail.com" becomes "firstlast@gmail.com".
//   - "name+news@example.com" and "first.last@outlook.com" do not change.
const DOMAIN_ALIASES: Record<string, string> = { 'googlemail.com': 'gmail.com' }

const PLUS_TAG_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'fastmail.com',
  'fastmail.fm',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
]

const DOT_BLIND_DOMAINS = ['gmail.com']

export function emailInboxKey(email: string): string {
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split('@')
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain
  let local = rawLocal
  if (PLUS_TAG_DOMAINS.includes(domain)) local = local.replace(/\+.*$/, '')
  if (DOT_BLIND_DOMAINS.includes(domain)) local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

function sqlList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(', ')
}

// The same function in SQL, for a column that holds a lowercase address.
// Migration 036 has a copy of this expression for the unique index. When you
// change a list above, add a migration that makes the index again.
export function emailInboxKeySql(column: string): string {
  const rawDomain = `split_part(${column}, '@', 2)`
  const aliasCases = Object.entries(DOMAIN_ALIASES)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(' ')
  const domain = `(CASE ${rawDomain} ${aliasCases} ELSE ${rawDomain} END)`
  const local = `split_part(${column}, '@', 1)`
  const withoutTag = `(CASE WHEN ${domain} IN (${sqlList(PLUS_TAG_DOMAINS)}) THEN split_part(${local}, '+', 1) ELSE ${local} END)`
  const key = `(CASE WHEN ${domain} IN (${sqlList(DOT_BLIND_DOMAINS)}) THEN replace(${withoutTag}, '.', '') ELSE ${withoutTag} END)`
  return `(${key} || '@' || ${domain})`
}
