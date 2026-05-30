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

// Auth uses JWT in the Authorization header (no cookies), so CORS restriction
// doesn't add security here — the JWT is what protects endpoints. Allow all
// origins so the app works regardless of which domain it's deployed to.
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

app.options('*', cors({ origin: true }))

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
