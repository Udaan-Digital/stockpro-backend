import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function listCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit
    const q = req.query.q as string | undefined
    const isActive = req.query.isActive as string | undefined

    const conditions: string[] = ['company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (q) {
      conditions.push(`(name ILIKE $${paramIdx} OR gstin ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`)
      params.push(`%${q}%`)
      paramIdx++
    }

    if (isActive !== undefined) {
      conditions.push(`is_active = $${paramIdx}`)
      params.push(isActive === 'true')
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM customers WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT * FROM customers WHERE ${where}
       ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Customer not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

function parsePaymentTerms(value: any): number {
  if (value === null || value === undefined) return 30
  if (typeof value === 'number') return value
  const match = String(value).match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

export async function createCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, gstin, email, phone, billingAddress, shippingAddress, paymentTerms, creditLimit } = req.body

    const result = await pool.query(
      `INSERT INTO customers (company_id, name, gstin, email, phone, billing_address, shipping_address, payment_terms, credit_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        req.user.companyId,
        name,
        gstin || null,
        email || null,
        phone || null,
        billingAddress ? JSON.stringify(billingAddress) : '{}',
        shippingAddress ? JSON.stringify(shippingAddress) : '{}',
        parsePaymentTerms(paymentTerms),
        creditLimit || 0,
      ]
    )

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function updateCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, gstin, email, phone, billingAddress, shippingAddress, paymentTerms, creditLimit, isActive } = req.body

    const result = await pool.query(
      `UPDATE customers SET
        name = COALESCE($1, name),
        gstin = COALESCE($2, gstin),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        billing_address = COALESCE($5, billing_address),
        shipping_address = COALESCE($6, shipping_address),
        payment_terms = COALESCE($7, payment_terms),
        credit_limit = COALESCE($8, credit_limit),
        is_active = COALESCE($9, is_active),
        updated_at = NOW()
      WHERE id = $10 AND company_id = $11 RETURNING *`,
      [
        name || null,
        gstin || null,
        email || null,
        phone || null,
        billingAddress ? JSON.stringify(billingAddress) : null,
        shippingAddress ? JSON.stringify(shippingAddress) : null,
        paymentTerms != null ? parsePaymentTerms(paymentTerms) : null,
        creditLimit || null,
        isActive ?? null,
        req.params.id,
        req.user.companyId,
      ]
    )

    if (result.rows.length === 0) {
      throw new AppError('Customer not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function deleteCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE customers SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING id, name, is_active`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Customer not found', 404)
    }

    res.json({ data: result.rows[0], message: 'Customer deactivated' })
  } catch (err) {
    next(err)
  }
}
