import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         sl.id, sl.product_id,
         p.name, p.sku, p.category, p.unit, p.cost_price, p.selling_price, p.tax_rate,
         sl.current_quantity, sl.min_threshold, sl.max_threshold, sl.last_updated_at,
         CASE
           WHEN sl.current_quantity <= 0 THEN 'OUT'
           WHEN sl.current_quantity <= sl.min_threshold THEN 'LOW'
           ELSE 'OK'
         END AS stock_status
       FROM products p
       INNER JOIN stock_levels sl ON sl.product_id = p.id
       WHERE p.company_id = $1 AND sl.company_id = $1 AND p.is_active = true
       ORDER BY p.name`,
      [req.user.companyId]
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function getProductStock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         p.id, p.name, p.sku, p.category, p.unit, p.cost_price, p.selling_price,
         sl.current_quantity, sl.min_threshold, sl.max_threshold, sl.last_updated_at,
         CASE
           WHEN sl.current_quantity <= 0 THEN 'OUT'
           WHEN sl.current_quantity <= sl.min_threshold THEN 'LOW'
           ELSE 'OK'
         END AS stock_status
       FROM products p
       INNER JOIN stock_levels sl ON sl.product_id = p.id
       WHERE p.id = $1 AND p.company_id = $2 AND sl.company_id = $2`,
      [req.params.productId, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Product or stock level not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function stockIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { productId, quantity, reason, notes, referenceType, referenceId } = req.body

    if (!quantity || quantity <= 0) {
      throw new AppError('Quantity must be greater than 0', 400)
    }

    await client.query('BEGIN')

    // Get product name
    const productResult = await client.query(
      'SELECT name FROM products WHERE id = $1 AND company_id = $2',
      [productId, req.user.companyId]
    )
    if (productResult.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    // Insert transaction
    await client.query(
      `INSERT INTO stock_transactions
         (company_id, product_id, product_name, transaction_type, quantity, reference_type, reference_id, reason, notes, created_by)
       VALUES ($1, $2, $3, 'IN', $4, $5, $6, $7, $8, $9)`,
      [
        req.user.companyId,
        productId,
        productResult.rows[0].name,
        quantity,
        referenceType || 'MANUAL',
        referenceId || null,
        reason || null,
        notes || null,
        req.user.name || req.user.email,
      ]
    )

    // Update stock level
    const updatedStock = await client.query(
      `UPDATE stock_levels
       SET current_quantity = current_quantity + $1, last_updated_at = NOW()
       WHERE product_id = $2 AND company_id = $3
       RETURNING *`,
      [quantity, productId, req.user.companyId]
    )

    await client.query('COMMIT')

    res.json({ data: updatedStock.rows[0], message: `Stock increased by ${quantity}` })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function stockOut(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { productId, quantity, reason, notes, referenceType, referenceId } = req.body

    if (!quantity || quantity <= 0) {
      throw new AppError('Quantity must be greater than 0', 400)
    }

    await client.query('BEGIN')

    const productResult = await client.query(
      'SELECT name FROM products WHERE id = $1 AND company_id = $2',
      [productId, req.user.companyId]
    )
    if (productResult.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    // Insert transaction
    await client.query(
      `INSERT INTO stock_transactions
         (company_id, product_id, product_name, transaction_type, quantity, reference_type, reference_id, reason, notes, created_by)
       VALUES ($1, $2, $3, 'OUT', $4, $5, $6, $7, $8, $9)`,
      [
        req.user.companyId,
        productId,
        productResult.rows[0].name,
        quantity,
        referenceType || 'MANUAL',
        referenceId || null,
        reason || null,
        notes || null,
        req.user.name || req.user.email,
      ]
    )

    // Update stock level (min 0)
    const updatedStock = await client.query(
      `UPDATE stock_levels
       SET current_quantity = GREATEST(0, current_quantity - $1), last_updated_at = NOW()
       WHERE product_id = $2 AND company_id = $3
       RETURNING *`,
      [quantity, productId, req.user.companyId]
    )

    await client.query('COMMIT')

    res.json({ data: updatedStock.rows[0], message: `Stock decreased by ${quantity}` })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function stockAdjust(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { productId, newQuantity, reason, notes } = req.body

    if (newQuantity === undefined || newQuantity < 0) {
      throw new AppError('New quantity must be >= 0', 400)
    }

    await client.query('BEGIN')

    const productResult = await client.query(
      'SELECT name FROM products WHERE id = $1 AND company_id = $2',
      [productId, req.user.companyId]
    )
    if (productResult.rows.length === 0) {
      throw new AppError('Product not found', 404)
    }

    // Get current quantity to calculate the adjustment delta
    const currentResult = await client.query(
      'SELECT current_quantity FROM stock_levels WHERE product_id = $1 AND company_id = $2',
      [productId, req.user.companyId]
    )
    const currentQty = currentResult.rows[0]?.current_quantity || 0
    const delta = newQuantity - parseFloat(currentQty)

    // Insert transaction
    await client.query(
      `INSERT INTO stock_transactions
         (company_id, product_id, product_name, transaction_type, quantity, reference_type, reason, notes, created_by)
       VALUES ($1, $2, $3, 'ADJUST', $4, 'ADJUSTMENT', $5, $6, $7)`,
      [
        req.user.companyId,
        productId,
        productResult.rows[0].name,
        Math.abs(delta),
        reason || `Adjustment from ${currentQty} to ${newQuantity}`,
        notes || null,
        req.user.name || req.user.email,
      ]
    )

    // Set stock level to new quantity
    const updatedStock = await client.query(
      `UPDATE stock_levels
       SET current_quantity = $1, last_updated_at = NOW()
       WHERE product_id = $2 AND company_id = $3
       RETURNING *`,
      [newQuantity, productId, req.user.companyId]
    )

    await client.query('COMMIT')

    res.json({ data: updatedStock.rows[0], message: `Stock adjusted to ${newQuantity}` })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function listTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit
    const productId = req.query.productId as string | undefined
    const transactionType = req.query.type as string | undefined

    const conditions: string[] = ['st.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (productId) {
      conditions.push(`st.product_id = $${paramIdx}`)
      params.push(productId)
      paramIdx++
    }

    if (transactionType) {
      conditions.push(`st.transaction_type = $${paramIdx}`)
      params.push(transactionType)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM stock_transactions st WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT st.*, p.name as product_name_current, p.sku, p.unit
       FROM stock_transactions st
       JOIN products p ON p.id = st.product_id
       WHERE ${where}
       ORDER BY st.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getLowStockItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         p.id, p.name, p.sku, p.category, p.unit, p.cost_price,
         sl.current_quantity, sl.min_threshold, sl.max_threshold,
         CASE WHEN sl.current_quantity <= 0 THEN 'OUT' ELSE 'LOW' END AS stock_status
       FROM products p
       INNER JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true
         AND sl.current_quantity <= sl.min_threshold
       ORDER BY sl.current_quantity ASC`,
      [req.user.companyId]
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function getValuation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(p.category, 'Uncategorized') AS category,
         COUNT(p.id) AS product_count,
         SUM(sl.current_quantity) AS total_quantity,
         SUM(sl.current_quantity * p.cost_price) AS total_cost_value,
         SUM(sl.current_quantity * p.selling_price) AS total_selling_value
       FROM products p
       INNER JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true
       GROUP BY COALESCE(p.category, 'Uncategorized')
       ORDER BY total_cost_value DESC`,
      [req.user.companyId]
    )

    const totalResult = await pool.query(
      `SELECT
         SUM(sl.current_quantity * p.cost_price) AS grand_total_cost,
         SUM(sl.current_quantity * p.selling_price) AS grand_total_selling
       FROM products p
       INNER JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true`,
      [req.user.companyId]
    )

    res.json({
      data: {
        byCategory: result.rows,
        totals: totalResult.rows[0],
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function updateThresholds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { minThreshold, maxThreshold } = req.body
    const { productId } = req.params

    const result = await pool.query(
      `UPDATE stock_levels SET
        min_threshold = COALESCE($1, min_threshold),
        max_threshold = COALESCE($2, max_threshold)
       WHERE product_id = $3 AND company_id = $4
       RETURNING *`,
      [minThreshold ?? null, maxThreshold ?? null, productId, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Stock level record not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}
