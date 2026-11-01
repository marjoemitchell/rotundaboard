// Many email services deliver "name+anything@example.com" to the inbox of
// "name@example.com". Gmail also ignores the dots before the "@", and
// "googlemail.com" is the same as "gmail.com". This function gives one key
// for each inbox, so that one inbox cannot make more than one account.
//   - "Name+News@Example.com" becomes "name@example.com".
//   - "First.Last+news@googlemail.com" becomes "firstlast@gmail.com".
//   - Dots stay in an address that is not a Gmail address.
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

export function emailInboxKey(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@')
  const withoutTag = local.replace(/\+.*$/, '')
  if (GMAIL_DOMAINS.includes(domain)) return `${withoutTag.replace(/\./g, '')}@gmail.com`
  return `${withoutTag}@${domain}`
}

// The same function in SQL, for a column that holds a lowercase address.
export function emailInboxKeySql(column: string): string {
  const withoutTag = `split_part(regexp_replace(${column}, '\\+[^@]*@', '@'), '@', 1)`
  const domain = `split_part(${column}, '@', 2)`
  return `(CASE WHEN ${domain} IN (${GMAIL_DOMAINS.map((d) => `'${d}'`).join(', ')})
    THEN replace(${withoutTag}, '.', '') || '@gmail.com'
    ELSE ${withoutTag} || '@' || ${domain} END)`
}
