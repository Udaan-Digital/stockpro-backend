import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

// Create pool if DATABASE_URL is provided (required for production)
const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL environment variable is not set!')
}

export const pool = new Pool({
  connectionString: dbUrl,
  max: 5, // keep low for serverless (Vercel reuses functions but caps connections)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err)
})

pool.on('connect', () => {
  console.log('PostgreSQL connected')
})

// Helper function to safely use pool (for backward compatibility)
export const getPool = () => pool
