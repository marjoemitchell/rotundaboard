import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (copy server/.env.example to server/.env)')
}

export const pool = new Pool({ connectionString })
