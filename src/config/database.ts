import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
