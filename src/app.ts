import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

dotenv.config()

import router from './routes/index'
import { errorHandler } from './middleware/errorHandler'

const app = express()

// Trust exactly 1 proxy hop (Vercel edge → function). Must not be `true`
// (too permissive) or `false` (breaks X-Forwarded-For detection).
app.set('trust proxy', 1)

app.use(helmet())

// Support comma-separated list in FRONTEND_URL, e.g. "https://a.com,https://b.com"
const allowedOrigins = [
  ...(process.env.FRONTEND_URL?.split(',').map(s => s.trim()) ?? []),
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile)
      if (!origin) return callback(null, true)
      if (allowedOrigins.some((o) => origin === o || origin.startsWith(o))) {
        return callback(null, true)
      }
      // Return null (not an error) so preflight gets a proper 204, not a 500
      return callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

// Explicitly respond to preflight so it always gets 204, not 404
app.options('*', cors())

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
})

app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api', limiter)

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'InvoicePro API', version: '1.0.0' })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'InvoicePro API' })
})

app.use('/api', router)

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

app.use(errorHandler)

export default app
