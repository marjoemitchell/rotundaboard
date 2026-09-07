import { execSync } from 'node:child_process'

// The DB pool/connection-string handling already lives in server/src/db.ts,
// so cleanup shells out to the server package's own script rather than
// duplicating a pg client (and its env parsing) in the frontend project.
export default async function globalTeardown() {
  execSync('npm run e2e:cleanup', { cwd: 'server', stdio: 'inherit' })
}
