import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function listPurchaseOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const conditions: string[] = ['po.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (req.query.status) {
      conditions.push(`po.status = $${paramIdx}`)
      params.push(req.query.status)
      paramIdx++
    }

    if (req.query.supplierId) {
      conditions.push(`po.supplier_id = $${paramIdx}`)
      params.push(req.query.supplierId)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM purchase_orders po WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT po.*, s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${where}
       ORDER BY po.po_date DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getPurchaseOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const poResult = await pool.query(
      `SELECT po.*, s.name AS supplier_name, s.gstin AS supplier_gstin, s.email AS supplier_email
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = $1 AND po.company_id = $2`,
      [req.params.id, req.user.companyId]
    )

    if (poResult.rows.length === 0) {
      throw new AppError('Purchase order not found', 404)
    }

    const itemsResult = await pool.query(
      'SELECT * FROM po_items WHERE po_id = $1',
      [req.params.id]
    )

    res.json({ data: { ...poResult.rows[0], items: itemsResult.rows } })
  } catch (err) {
    next(err)
  }
}

export async function createPurchaseOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { supplierId, poDate, expectedDeliveryDate, notes, status, items } = req.body

    if (!items || items.length === 0) {
      throw new AppError('Purchase order must have at least one item', 400)
    }

    await client.query('BEGIN')

    // Generate PO number
    const poCountResult = await client.query(
      'SELECT COUNT(*) FROM purchase_orders WHERE company_id = $1',
      [req.user.companyId]
    )
    const poCount = parseInt(poCountResult.rows[0].count, 10) + 1
    const poNumber = `PO-${String(poCount).padStart(5, '0')}`

    // Calculate totals
    let subtotal = 0
    let taxAmount = 0
    for (const item of items) {
      const itemTotal = parseFloat(item.rate) * parseFloat(item.quantity)
      subtotal += itemTotal
    }
    const total = subtotal + taxAmount

    const poResult = await client.query(
      `INSERT INTO purchase_orders (company_id, po_number, supplier_id, po_date, expected_delivery_date, subtotal, tax_amount, total, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        req.user.companyId,
        poNumber,
        supplierId || null,
        poDate || new Date().toISOString().split('T')[0],
        expectedDeliveryDate || null,
        subtotal,
        taxAmount,
        total,
        status || 'DRAFT',
        notes || null,
        req.user.id,
      ]
    )
    const po = poResult.rows[0]

    // Insert PO items
    for (const item of items) {
      const itemTotal = parseFloat(item.rate) * parseFloat(item.quantity)
      await client.query(
        `INSERT INTO po_items (po_id, product_id, product_name, quantity, rate, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [po.id, item.productId || null, item.productName, item.quantity, item.rate, itemTotal]
      )
    }

    await client.query('COMMIT')

    const itemsResult = await pool.query('SELECT * FROM po_items WHERE po_id = $1', [po.id])
    res.status(201).json({ data: { ...po, items: itemsResult.rows } })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function updatePurchaseOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { supplierId, poDate, expectedDeliveryDate, notes, status, items } = req.body
    const { id } = req.params

    const current = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2',
      [id, req.user.companyId]
    )
    if (current.rows.length === 0) {
      throw new AppError('Purchase order not found', 404)
    }
    if (current.rows[0].status === 'RECEIVED' || current.rows[0].status === 'CANCELLED') {
      throw new AppError(`Cannot update a ${current.rows[0].status} purchase order`, 400)
    }

    await client.query('BEGIN')

    let subtotal = current.rows[0].subtotal
    let total = current.rows[0].total

    if (items && items.length > 0) {
      subtotal = 0
      for (const item of items) {
        subtotal += parseFloat(item.rate) * parseFloat(item.quantity)
      }
      total = subtotal
    }

    await client.query(
      `UPDATE purchase_orders SET
        supplier_id = COALESCE($1, supplier_id),
        po_date = COALESCE($2, po_date),
        expected_delivery_date = COALESCE($3, expected_delivery_date),
        notes = COALESCE($4, notes),
        status = COALESCE($5, status),
        subtotal = $6,
        total = $7,
        updated_at = NOW()
      WHERE id = $8 AND company_id = $9`,
      [supplierId || null, poDate || null, expectedDeliveryDate || null, notes || null, status || null, subtotal, total, id, req.user.companyId]
    )

    if (items && items.length > 0) {
      await client.query('DELETE FROM po_items WHERE po_id = $1', [id])
      for (const item of items) {
        const itemTotal = parseFloat(item.rate) * parseFloat(item.quantity)
        await client.query(
          `INSERT INTO po_items (po_id, product_id, product_name, quantity, rate, total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, item.productId || null, item.productName, item.quantity, item.rate, itemTotal]
        )
      }
    }

    await client.query('COMMIT')

    const updatedPO = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [id])
    const updatedItems = await pool.query('SELECT * FROM po_items WHERE po_id = $1', [id])
    res.json({ data: { ...updatedPO.rows[0], items: updatedItems.rows } })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function deletePurchaseOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE purchase_orders SET status = 'CANCELLED', updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status NOT IN ('RECEIVED')
       RETURNING id, po_number, status`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Purchase order not found or cannot be cancelled', 404)
    }

    res.json({ data: result.rows[0], message: 'Purchase order cancelled' })
  } catch (err) {
    next(err)
  }
}

export async function receiveGRN(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { id } = req.params

    const poResult = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND company_id = $2',
      [id, req.user.companyId]
    )
    if (poResult.rows.length === 0) {
      throw new AppError('Purchase order not found', 404)
    }
    const po = poResult.rows[0]

    if (po.status === 'RECEIVED') {
      throw new AppError('Purchase order already received', 400)
    }
    if (po.status === 'CANCELLED') {
      throw new AppError('Cannot receive a cancelled purchase order', 400)
    }

    const itemsResult = await client.query(
      'SELECT * FROM po_items WHERE po_id = $1',
      [id]
    )

    await client.query('BEGIN')

    // Stock in all items
    for (const item of itemsResult.rows) {
      if (item.product_id) {
        const productResult = await client.query(
          'SELECT name FROM products WHERE id = $1',
          [item.product_id]
        )
        const productName = productResult.rows[0]?.name || item.product_name

        await client.query(
          `INSERT INTO stock_transactions
             (company_id, product_id, product_name, transaction_type, quantity, reference_type, reference_id, reason, created_by)
           VALUES ($1,$2,$3,'IN',$4,'PO',$5,'GRN from PO',$6)`,
          [req.user.companyId, item.product_id, productName, item.quantity, id, req.user.email]
        )

        await client.query(
          `UPDATE stock_levels SET current_quantity = current_quantity + $1, last_updated_at = NOW()
           WHERE product_id = $2 AND company_id = $3`,
          [item.quantity, item.product_id, req.user.companyId]
        )
      }
    }

    // Update PO status
    await client.query(
      `UPDATE purchase_orders SET status = 'RECEIVED', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    await client.query('COMMIT')

    res.json({ message: 'GRN processed — stock updated', data: { id, status: 'RECEIVED' } })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}
