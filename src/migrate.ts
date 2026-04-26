import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const sql = fs.readFileSync(path.join(process.cwd(), 'src/migrations/001_initial.sql'), 'utf8')
    await pool.query(sql)
    console.log('Migration completed')
  } finally {
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
