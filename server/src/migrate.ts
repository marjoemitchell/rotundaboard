import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '..', 'migrations')

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations')
    const applied = new Set(rows.map((r) => r.name))

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`)
        continue
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8')
      console.log(`apply ${file}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log('migrations up to date')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
