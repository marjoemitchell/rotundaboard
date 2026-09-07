import { randomBytes, createHash } from 'node:crypto'

// The raw token is the bearer secret (like a password) — it goes into a
// cookie or an emailed link, and only its hash is ever stored, same
// principle as password_hash never storing the plaintext password.
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}
