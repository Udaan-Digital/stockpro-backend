import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const dbUrl = process.env.DATABASE_URL

if (!dbUrl) {
  console.error('DATABASE_URL environment variable is not set!')
} else {
  console.log('Database: Connection string configured')
}

// Serverless-optimised pool: single connection, SSL required for Supabase
export const pool = new Pool({
  connectionString: dbUrl,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  ssl: dbUrl?.includes('supabase') || dbUrl?.includes('pooler')
    ? { rejectUnauthorized: false }
    : undefined,
})

pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err)
})

pool.on('connect', () => {
  console.log('PostgreSQL connected')
})

export const getPool = () => pool
