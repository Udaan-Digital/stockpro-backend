import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function listSuppliers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit
    const q = req.query.q as string | undefined

    const conditions: string[] = ['company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (q) {
      conditions.push(`(name ILIKE $${paramIdx} OR gstin ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`)
      params.push(`%${q}%`)
      paramIdx++
    }

    if (req.query.isActive !== undefined) {
      conditions.push(`is_active = $${paramIdx}`)
      params.push(req.query.isActive === 'true')
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM suppliers WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT * FROM suppliers WHERE ${where} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getSupplier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM suppliers WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.companyId]
    )
    if (result.rows.length === 0) {
      throw new AppError('Supplier not found', 404)
    }
    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function createSupplier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, gstin, email, phone, address, paymentTerms } = req.body

    const result = await pool.query(
      `INSERT INTO suppliers (company_id, name, gstin, email, phone, address, payment_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.user.companyId,
        name,
        gstin || null,
        email || null,
        phone || null,
        address ? JSON.stringify(address) : '{}',
        paymentTerms || 30,
      ]
    )

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function updateSupplier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, gstin, email, phone, address, paymentTerms, isActive } = req.body

    const result = await pool.query(
      `UPDATE suppliers SET
        name = COALESCE($1, name),
        gstin = COALESCE($2, gstin),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        address = COALESCE($5, address),
        payment_terms = COALESCE($6, payment_terms),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      WHERE id = $8 AND company_id = $9 RETURNING *`,
      [
        name || null,
        gstin || null,
        email || null,
        phone || null,
        address ? JSON.stringify(address) : null,
        paymentTerms || null,
        isActive ?? null,
        req.params.id,
        req.user.companyId,
      ]
    )

    if (result.rows.length === 0) {
      throw new AppError('Supplier not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function deleteSupplier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE suppliers SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING id, name, is_active`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Supplier not found', 404)
    }

    res.json({ data: result.rows[0], message: 'Supplier deactivated' })
  } catch (err) {
    next(err)
  }
}
