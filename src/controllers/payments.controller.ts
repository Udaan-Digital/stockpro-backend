import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

async function recalculatePaymentStatus(invoiceId: string): Promise<void> {
  const paymentSum = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1',
    [invoiceId]
  )
  const totalPaid = parseFloat(paymentSum.rows[0].total_paid)

  const invoiceResult = await pool.query(
    'SELECT final_amount FROM invoices WHERE id = $1',
    [invoiceId]
  )
  const finalAmount = parseFloat(invoiceResult.rows[0].final_amount)

  let paymentStatus: string
  if (totalPaid <= 0) {
    paymentStatus = 'UNPAID'
  } else if (totalPaid >= finalAmount) {
    paymentStatus = 'PAID'
  } else {
    paymentStatus = 'PARTIAL'
  }

  await pool.query(
    'UPDATE invoices SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
    [totalPaid, paymentStatus, invoiceId]
  )
}

export async function createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { invoiceId, amount, paymentMethod, paymentDate, referenceNumber, notes } = req.body

    if (!amount || amount <= 0) {
      throw new AppError('Payment amount must be greater than 0', 400)
    }

    // Verify invoice belongs to company
    const invoiceResult = await client.query(
      'SELECT id, final_amount, invoice_status FROM invoices WHERE id = $1 AND company_id = $2',
      [invoiceId, req.user.companyId]
    )
    if (invoiceResult.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }
    if (invoiceResult.rows[0].invoice_status === 'CANCELLED') {
      throw new AppError('Cannot add payment to a cancelled invoice', 400)
    }

    await client.query('BEGIN')

    const result = await client.query(
      `INSERT INTO payments (invoice_id, company_id, amount, payment_method, payment_date, reference_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        invoiceId,
        req.user.companyId,
        amount,
        paymentMethod || 'TRANSFER',
        paymentDate || new Date().toISOString().split('T')[0],
        referenceNumber || null,
        notes || null,
        req.user.email,
      ]
    )

    // Recalculate payment status
    const paymentSum = await client.query(
      'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1',
      [invoiceId]
    )
    const totalPaid = parseFloat(paymentSum.rows[0].total_paid)
    const finalAmount = parseFloat(invoiceResult.rows[0].final_amount)

    let paymentStatus: string
    if (totalPaid <= 0) {
      paymentStatus = 'UNPAID'
    } else if (totalPaid >= finalAmount) {
      paymentStatus = 'PAID'
    } else {
      paymentStatus = 'PARTIAL'
    }

    await client.query(
      'UPDATE invoices SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
      [totalPaid, paymentStatus, invoiceId]
    )

    await client.query('COMMIT')

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function getInvoicePayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Verify invoice belongs to company
    const invoiceResult = await pool.query(
      'SELECT id FROM invoices WHERE id = $1 AND company_id = $2',
      [req.params.invoiceId, req.user.companyId]
    )
    if (invoiceResult.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    const result = await pool.query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC',
      [req.params.invoiceId]
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function listPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const conditions: string[] = ['p.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (req.query.from) {
      conditions.push(`p.payment_date >= $${paramIdx}`)
      params.push(req.query.from)
      paramIdx++
    }
    if (req.query.to) {
      conditions.push(`p.payment_date <= $${paramIdx}`)
      params.push(req.query.to)
      paramIdx++
    }
    if (req.query.method) {
      conditions.push(`p.payment_method = $${paramIdx}`)
      params.push(req.query.method)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM payments p WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT p.*, i.invoice_number, i.customer_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE ${where}
       ORDER BY p.payment_date DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function updatePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { amount, paymentMethod, paymentDate, referenceNumber, notes } = req.body

    // Verify payment belongs to company
    const paymentResult = await client.query(
      'SELECT p.*, i.company_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1 AND i.company_id = $2',
      [req.params.id, req.user.companyId]
    )
    if (paymentResult.rows.length === 0) {
      throw new AppError('Payment not found', 404)
    }

    const invoiceId = paymentResult.rows[0].invoice_id

    await client.query('BEGIN')

    const result = await client.query(
      `UPDATE payments SET
        amount = COALESCE($1, amount),
        payment_method = COALESCE($2, payment_method),
        payment_date = COALESCE($3, payment_date),
        reference_number = COALESCE($4, reference_number),
        notes = COALESCE($5, notes)
      WHERE id = $6 RETURNING *`,
      [amount || null, paymentMethod || null, paymentDate || null, referenceNumber || null, notes || null, req.params.id]
    )

    // Recalculate
    const paymentSum = await client.query(
      'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1',
      [invoiceId]
    )
    const totalPaid = parseFloat(paymentSum.rows[0].total_paid)
    const invoiceRes = await client.query('SELECT final_amount FROM invoices WHERE id = $1', [invoiceId])
    const finalAmount = parseFloat(invoiceRes.rows[0].final_amount)
    const paymentStatus = totalPaid <= 0 ? 'UNPAID' : totalPaid >= finalAmount ? 'PAID' : 'PARTIAL'
    await client.query(
      'UPDATE invoices SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
      [totalPaid, paymentStatus, invoiceId]
    )

    await client.query('COMMIT')

    res.json({ data: result.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function deletePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const paymentResult = await client.query(
      'SELECT p.*, i.company_id, p.invoice_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1 AND i.company_id = $2',
      [req.params.id, req.user.companyId]
    )
    if (paymentResult.rows.length === 0) {
      throw new AppError('Payment not found', 404)
    }

    const invoiceId = paymentResult.rows[0].invoice_id

    await client.query('BEGIN')
    await client.query('DELETE FROM payments WHERE id = $1', [req.params.id])

    // Recalculate
    const paymentSum = await client.query(
      'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1',
      [invoiceId]
    )
    const totalPaid = parseFloat(paymentSum.rows[0].total_paid)
    const invoiceRes = await client.query('SELECT final_amount FROM invoices WHERE id = $1', [invoiceId])
    const finalAmount = parseFloat(invoiceRes.rows[0].final_amount)
    const paymentStatus = totalPaid <= 0 ? 'UNPAID' : totalPaid >= finalAmount ? 'PAID' : 'PARTIAL'
    await client.query(
      'UPDATE invoices SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
      [totalPaid, paymentStatus, invoiceId]
    )

    await client.query('COMMIT')

    res.json({ message: 'Payment deleted' })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}
