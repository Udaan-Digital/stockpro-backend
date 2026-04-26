import { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM users WHERE company_id = $1',
      [req.user.companyId]
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT id, company_id, email, name, phone, role, is_active, last_login, created_at
       FROM users WHERE company_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.companyId, limit, offset]
    )

    res.json({
      data: result.rows,
      meta: { total, page, limit },
    })
  } catch (err) {
    next(err)
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, company_id, email, name, phone, role, is_active, last_login, created_at
       FROM users WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, name, phone, role, password } = req.body

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      throw new AppError('Email already in use', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const result = await pool.query(
      `INSERT INTO users (company_id, email, name, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_id, email, name, phone, role, is_active, created_at`,
      [req.user.companyId, email, name, phone || null, role || 'SALES', passwordHash]
    )

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, phone, role, isActive, password } = req.body
    const { id } = req.params

    // Prevent non-admins from changing roles
    if (role && req.user.role !== 'ADMIN') {
      throw new AppError('Only admins can change user roles', 403)
    }

    let passwordUpdate = ''
    const params: any[] = [name || null, phone || null, role || null, isActive, id, req.user.companyId]

    if (password) {
      const passwordHash = await bcrypt.hash(password, 12)
      params.splice(4, 0, passwordHash)
      passwordUpdate = ', password_hash = COALESCE($5, password_hash)'
    }

    const idx = password ? [1, 2, 3, 4, 6, 7] : [1, 2, 3, 4, 5, 6]

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        role = COALESCE($3, role),
        is_active = $4
        ${password ? `, password_hash = $5` : ''}
      WHERE id = $${password ? 6 : 5} AND company_id = $${password ? 7 : 6}
      RETURNING id, company_id, email, name, phone, role, is_active, last_login, created_at`,
      password
        ? [name || null, phone || null, role || null, isActive ?? true, await bcrypt.hash(password, 12), id, req.user.companyId]
        : [name || null, phone || null, role || null, isActive ?? true, id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params

    if (id === req.user.id) {
      throw new AppError('Cannot deactivate your own account', 400)
    }

    const result = await pool.query(
      `UPDATE users SET is_active = false
       WHERE id = $1 AND company_id = $2
       RETURNING id, email, name, is_active`,
      [id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404)
    }

    res.json({ data: result.rows[0], message: 'User deactivated' })
  } catch (err) {
    next(err)
  }
}
