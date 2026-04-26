import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit
    const q = req.query.q as string | undefined
    const category = req.query.category as string | undefined
    const isActive = req.query.isActive as string | undefined

    const conditions: string[] = ['p.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (q) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx} OR p.hsn_code ILIKE $${paramIdx})`)
      params.push(`%${q}%`)
      paramIdx++
    }

    if (category) {
      conditions.push(`p.category = $${paramIdx}`)
      params.push(category)
      paramIdx++
    }

    if (isActive !== undefined) {
      conditions.push(`p.is_active = $${paramIdx}`)
      params.push(isActive === 'true')
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products p WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT p.*, sl.current_quantity, sl.min_threshold, sl.max_threshold
       FROM products p
       LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE ${where}
       ORDER BY p.name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT p.*, sl.current_quantity, sl.min_threshold, sl.max_threshold
       FROM products p
       LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const {
      name,
      sku,
      hsnCode,
      description,
      category,
      unit,
      costPrice,
      sellingPrice,
      mrp,
      taxRate,
      imageUrl,
      minThreshold,
      maxThreshold,
    } = req.body

    await client.query('BEGIN')

    const productResult = await client.query(
      `INSERT INTO products
        (company_id, name, sku, hsn_code, description, category, unit, cost_price, selling_price, mrp, tax_rate, image_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user.companyId,
        name,
        sku || null,
        hsnCode || null,
        description || null,
        category || null,
        unit || 'PCS',
        costPrice || 0,
        sellingPrice || 0,
        mrp || sellingPrice || 0,
        taxRate || 18,
        imageUrl || null,
        req.user.id,
      ]
    )

    const product = productResult.rows[0]

    // Create stock level entry
    await client.query(
      `INSERT INTO stock_levels (company_id, product_id, current_quantity, min_threshold, max_threshold)
       VALUES ($1, $2, 0, $3, $4)`,
      [req.user.companyId, product.id, minThreshold || 0, maxThreshold || 1000]
    )

    await client.query('COMMIT')

    res.status(201).json({ data: product })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      name,
      sku,
      hsnCode,
      description,
      category,
      unit,
      costPrice,
      sellingPrice,
      mrp,
      taxRate,
      imageUrl,
      isActive,
    } = req.body

    const result = await pool.query(
      `UPDATE products SET
        name = COALESCE($1, name),
        sku = COALESCE($2, sku),
        hsn_code = COALESCE($3, hsn_code),
        description = COALESCE($4, description),
        category = COALESCE($5, category),
        unit = COALESCE($6, unit),
        cost_price = COALESCE($7, cost_price),
        selling_price = COALESCE($8, selling_price),
        mrp = COALESCE($9, mrp),
        tax_rate = COALESCE($10, tax_rate),
        image_url = COALESCE($11, image_url),
        is_active = COALESCE($12, is_active),
        updated_at = NOW()
      WHERE id = $13 AND company_id = $14 RETURNING *`,
      [
        name || null,
        sku || null,
        hsnCode || null,
        description || null,
        category || null,
        unit || null,
        costPrice ?? null,
        sellingPrice ?? null,
        mrp ?? null,
        taxRate ?? null,
        imageUrl || null,
        isActive ?? null,
        req.params.id,
        req.user.companyId,
      ]
    )

    if (result.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE products SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING id, name, is_active`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    res.json({ data: result.rows[0], message: 'Product deactivated' })
  } catch (err) {
    next(err)
  }
}

export async function getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT category FROM products
       WHERE company_id = $1 AND category IS NOT NULL AND is_active = true
       ORDER BY category`,
      [req.user.companyId]
    )

    res.json({ data: result.rows.map((r) => r.category) })
  } catch (err) {
    next(err)
  }
}
