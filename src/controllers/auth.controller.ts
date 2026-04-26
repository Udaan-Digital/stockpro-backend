import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'
import { z } from 'zod'

function signAccessToken(payload: { id: string; email: string; name: string; role: string; companyId: string }): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
  })
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
  })
}

async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  )
}

async function deleteRefreshToken(userId: string, token: string): Promise<void> {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2',
    [userId, token]
  )
}

async function validateRefreshToken(userId: string, token: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM refresh_tokens WHERE user_id = $1 AND token = $2 AND expires_at > NOW()',
    [userId, token]
  )
  return result.rows.length > 0
}

export const registerSchema = z.object({
  companyName: z.string().min(2).max(255),
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  businessType: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const {
      companyName,
      gstin,
      pan,
      businessType,
      contactEmail,
      contactPhone,
      name,
      email,
      password,
      phone,
    } = req.body

    // Check if email already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      throw new AppError('Email already registered', 409)
    }

    await client.query('BEGIN')

    // Create company
    const companyResult = await client.query(
      `INSERT INTO companies (name, gstin, pan, business_type, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [companyName, gstin || null, pan || null, businessType || null, contactEmail || email, contactPhone || null]
    )
    const company = companyResult.rows[0]

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create admin user
    const userResult = await client.query(
      `INSERT INTO users (company_id, email, name, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, 'ADMIN', $5) RETURNING id, email, name, role, company_id`,
      [company.id, email, name, phone || null, passwordHash]
    )
    const user = userResult.rows[0]

    await client.query('COMMIT')

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.company_id,
    })
    const refreshToken = signRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshToken)

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body

    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.company_id, u.password_hash, u.is_active
       FROM users u WHERE u.email = $1`,
      [email]
    )

    if (result.rows.length === 0) {
      throw new AppError('Invalid email or password', 401)
    }

    const user = result.rows[0]

    if (!user.is_active) {
      throw new AppError('Account is deactivated', 403)
    }

    const isValid = await bcrypt.compare(password, user.password_hash)
    if (!isValid) {
      throw new AppError('Invalid email or password', 401)
    }

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.company_id,
    })
    const refreshToken = signRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshToken)

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body
    if (!token) {
      throw new AppError('Refresh token required', 400)
    }

    let decoded: any
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET as string)
    } catch {
      throw new AppError('Invalid refresh token', 401)
    }

    const userId = decoded.id
    const isValid = await validateRefreshToken(userId, token)
    if (!isValid) {
      throw new AppError('Refresh token revoked or expired', 401)
    }

    const userResult = await pool.query(
      'SELECT id, email, name, role, company_id, is_active FROM users WHERE id = $1',
      [userId]
    )
    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      throw new AppError('User not found or inactive', 401)
    }

    const user = userResult.rows[0]
    const newAccessToken = signAccessToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.company_id,
    })

    res.json({ accessToken: newAccessToken })
  } catch (err) {
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken: token } = req.body
    if (token && req.user) {
      await deleteRefreshToken(req.user.id, token)
    }
    res.json({ message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.company_id, u.is_active, u.last_login, u.created_at,
              c.name as company_name, c.gstin, c.invoice_prefix
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404)
    }

    const user = result.rows[0]
    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        companyId: user.company_id,
        isActive: user.is_active,
        lastLogin: user.last_login,
        createdAt: user.created_at,
        company: {
          id: user.company_id,
          name: user.company_name,
          gstin: user.gstin,
          invoicePrefix: user.invoice_prefix,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}
