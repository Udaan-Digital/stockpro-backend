import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'
import { calculateItemTotals, calculateInvoiceSummary } from '../services/tax.service'
import { generateInvoicePDF } from '../services/pdf.service'
import { sendInvoiceEmail } from '../services/email.service'

function parsePaymentTerms(value: any): number {
  if (value === null || value === undefined) return 30
  if (typeof value === 'number') return value
  const match = String(value).match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

export async function listInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const conditions: string[] = ['i.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (req.query.status) {
      conditions.push(`i.invoice_status = $${paramIdx}`)
      params.push(req.query.status)
      paramIdx++
    }

    if (req.query.paymentStatus) {
      conditions.push(`i.payment_status = $${paramIdx}`)
      params.push(req.query.paymentStatus)
      paramIdx++
    }

    if (req.query.customerId) {
      conditions.push(`i.customer_id = $${paramIdx}`)
      params.push(req.query.customerId)
      paramIdx++
    }

    if (req.query.from) {
      conditions.push(`i.invoice_date >= $${paramIdx}`)
      params.push(req.query.from)
      paramIdx++
    }

    if (req.query.to) {
      conditions.push(`i.invoice_date <= $${paramIdx}`)
      params.push(req.query.to)
      paramIdx++
    }

    if (req.query.q) {
      conditions.push(`(i.invoice_number ILIKE $${paramIdx} OR i.customer_name ILIKE $${paramIdx})`)
      params.push(`%${req.query.q}%`)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM invoices i WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT
         i.*,
         CASE
           WHEN i.invoice_status NOT IN ('PAID','CANCELLED') AND i.due_date < CURRENT_DATE THEN true
           ELSE false
         END AS is_overdue
       FROM invoices i
       WHERE ${where}
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceResult = await pool.query(
      `SELECT i.*,
         CASE
           WHEN i.invoice_status NOT IN ('PAID','CANCELLED') AND i.due_date < CURRENT_DATE THEN true
           ELSE false
         END AS is_overdue
       FROM invoices i
       WHERE i.id = $1 AND i.company_id = $2`,
      [req.params.id, req.user.companyId]
    )

    if (invoiceResult.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    const itemsResult = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [req.params.id]
    )

    const paymentsResult = await pool.query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC',
      [req.params.id]
    )

    res.json({
      data: {
        ...invoiceResult.rows[0],
        items: itemsResult.rows,
        payments: paymentsResult.rows,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const {
      invoiceDate,
      dueDate,
      customerId,
      customerName,
      customerGstin,
      customerAddress,
      isInterState,
      paymentTerms,
      notes,
      invoiceStatus,
      items,
    } = req.body

    if (!items || items.length === 0) {
      throw new AppError('Invoice must have at least one item', 400)
    }

    await client.query('BEGIN')

    // Generate invoice number
    const companyResult = await client.query(
      'SELECT invoice_prefix, invoice_current_number FROM companies WHERE id = $1 FOR UPDATE',
      [req.user.companyId]
    )
    const { invoice_prefix, invoice_current_number } = companyResult.rows[0]
    const invoiceNumber = `${invoice_prefix}-${String(invoice_current_number).padStart(5, '0')}`

    // Increment invoice number
    await client.query(
      'UPDATE companies SET invoice_current_number = invoice_current_number + 1 WHERE id = $1',
      [req.user.companyId]
    )

    // Calculate totals
    const itemInputs = items.map((item: any) => ({
      rate: parseFloat(item.rate),
      quantity: parseFloat(item.quantity),
      discountPercent: parseFloat(item.discountPercent || 0),
      taxRate: parseFloat(item.taxRate),
    }))
    const summary = calculateInvoiceSummary(itemInputs, isInterState)

    // Insert invoice
    const invoiceResult = await client.query(
      `INSERT INTO invoices
         (company_id, invoice_number, invoice_date, due_date, customer_id, customer_name,
          customer_gstin, customer_address, is_inter_state, payment_terms, subtotal, total_discount,
          taxable_amount, sgst_amount, cgst_amount, igst_amount, total_tax, round_off, final_amount,
          invoice_status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        req.user.companyId,
        invoiceNumber,
        invoiceDate || new Date().toISOString().split('T')[0],
        dueDate || null,
        customerId || null,
        customerName,
        customerGstin || null,
        customerAddress ? JSON.stringify(customerAddress) : '{}',
        isInterState || false,
        parsePaymentTerms(paymentTerms),
        summary.subtotal,
        summary.totalDiscount,
        summary.taxableAmount,
        summary.sgstAmount,
        summary.cgstAmount,
        summary.igstAmount,
        summary.totalTax,
        summary.roundOff,
        summary.finalAmount,
        invoiceStatus || 'DRAFT',
        notes || null,
        req.user.id,
      ]
    )
    const invoice = invoiceResult.rows[0]

    // Insert invoice items
    for (const item of items) {
      const totals = calculateItemTotals(
        parseFloat(item.rate),
        parseFloat(item.quantity),
        parseFloat(item.discountPercent || 0),
        parseFloat(item.taxRate),
        isInterState
      )

      await client.query(
        `INSERT INTO invoice_items
           (invoice_id, product_id, product_name, hsn_code, quantity, unit, rate, discount_percent,
            discount_amount, amount, tax_rate, tax_amount, sgst_amount, cgst_amount, igst_amount, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          invoice.id,
          item.productId || null,
          item.productName,
          item.hsnCode || null,
          item.quantity,
          item.unit || 'PCS',
          item.rate,
          item.discountPercent || 0,
          totals.discountAmount,
          totals.taxableAmount,
          item.taxRate,
          totals.taxAmount,
          totals.sgstAmount,
          totals.cgstAmount,
          totals.igstAmount,
          totals.total,
        ]
      )
    }

    // Deduct stock if invoice is not DRAFT
    if (invoiceStatus && invoiceStatus !== 'DRAFT') {
      for (const item of items) {
        if (item.productId) {
          const productResult = await client.query(
            'SELECT name FROM products WHERE id = $1 AND company_id = $2',
            [item.productId, req.user.companyId]
          )
          if (productResult.rows.length > 0) {
            await client.query(
              `INSERT INTO stock_transactions
                 (company_id, product_id, product_name, transaction_type, quantity, reference_type, reference_id, reason, created_by)
               VALUES ($1,$2,$3,'OUT',$4,'INVOICE',$5,'Invoice sale',$6)`,
              [req.user.companyId, item.productId, productResult.rows[0].name, item.quantity, invoice.id, req.user.email]
            )
            await client.query(
              `UPDATE stock_levels SET current_quantity = GREATEST(0, current_quantity - $1), last_updated_at = NOW()
               WHERE product_id = $2 AND company_id = $3`,
              [item.quantity, item.productId, req.user.companyId]
            )
          }
        }
      }
    }

    await client.query('COMMIT')

    const itemsResult = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoice.id])
    res.status(201).json({ data: { ...invoice, items: itemsResult.rows } })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function updateInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  const client = await pool.connect()
  try {
    const { id } = req.params

    // Check current status
    const current = await client.query(
      'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
      [id, req.user.companyId]
    )
    if (current.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    const currentInvoice = current.rows[0]
    if (currentInvoice.invoice_status === 'CANCELLED') {
      throw new AppError('Cannot update a cancelled invoice', 400)
    }

    const {
      invoiceDate,
      dueDate,
      customerName,
      customerGstin,
      customerAddress,
      isInterState,
      paymentTerms,
      notes,
      invoiceStatus,
      items,
    } = req.body

    await client.query('BEGIN')

    let updateFields: any = {
      invoice_date: invoiceDate,
      due_date: dueDate,
      customer_name: customerName,
      customer_gstin: customerGstin,
      customer_address: customerAddress ? JSON.stringify(customerAddress) : undefined,
      is_inter_state: isInterState,
      payment_terms: paymentTerms != null ? parsePaymentTerms(paymentTerms) : undefined,
      notes,
      invoice_status: invoiceStatus,
      updated_at: new Date(),
    }

    let summary: any = null
    if (items && items.length > 0) {
      const itemInputs = items.map((item: any) => ({
        rate: parseFloat(item.rate),
        quantity: parseFloat(item.quantity),
        discountPercent: parseFloat(item.discountPercent || 0),
        taxRate: parseFloat(item.taxRate),
      }))
      const effectiveIsInterState = isInterState !== undefined ? isInterState : currentInvoice.is_inter_state
      summary = calculateInvoiceSummary(itemInputs, effectiveIsInterState)
      Object.assign(updateFields, {
        subtotal: summary.subtotal,
        total_discount: summary.totalDiscount,
        taxable_amount: summary.taxableAmount,
        sgst_amount: summary.sgstAmount,
        cgst_amount: summary.cgstAmount,
        igst_amount: summary.igstAmount,
        total_tax: summary.totalTax,
        round_off: summary.roundOff,
        final_amount: summary.finalAmount,
      })
    }

    // Build dynamic SET clause
    const setClauses: string[] = []
    const setParams: any[] = []
    let pi = 1

    for (const [key, val] of Object.entries(updateFields)) {
      if (val !== undefined) {
        setClauses.push(`${key} = $${pi}`)
        setParams.push(val)
        pi++
      }
    }

    if (setClauses.length > 0) {
      setParams.push(id, req.user.companyId)
      await client.query(
        `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $${pi} AND company_id = $${pi + 1}`,
        setParams
      )
    }

    // Replace items if provided
    if (items && items.length > 0) {
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id])
      const effectiveIsInterState = isInterState !== undefined ? isInterState : currentInvoice.is_inter_state

      for (const item of items) {
        const totals = calculateItemTotals(
          parseFloat(item.rate),
          parseFloat(item.quantity),
          parseFloat(item.discountPercent || 0),
          parseFloat(item.taxRate),
          effectiveIsInterState
        )
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id, product_id, product_name, hsn_code, quantity, unit, rate, discount_percent,
              discount_amount, amount, tax_rate, tax_amount, sgst_amount, cgst_amount, igst_amount, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            id,
            item.productId || null,
            item.productName,
            item.hsnCode || null,
            item.quantity,
            item.unit || 'PCS',
            item.rate,
            item.discountPercent || 0,
            totals.discountAmount,
            totals.taxableAmount,
            item.taxRate,
            totals.taxAmount,
            totals.sgstAmount,
            totals.cgstAmount,
            totals.igstAmount,
            totals.total,
          ]
        )
      }
    }

    // If status changed from DRAFT to SENT, deduct stock
    if (
      currentInvoice.invoice_status === 'DRAFT' &&
      invoiceStatus &&
      invoiceStatus !== 'DRAFT' &&
      items
    ) {
      for (const item of items) {
        if (item.productId) {
          const productResult = await client.query(
            'SELECT name FROM products WHERE id = $1 AND company_id = $2',
            [item.productId, req.user.companyId]
          )
          if (productResult.rows.length > 0) {
            await client.query(
              `INSERT INTO stock_transactions
                 (company_id, product_id, product_name, transaction_type, quantity, reference_type, reference_id, reason, created_by)
               VALUES ($1,$2,$3,'OUT',$4,'INVOICE',$5,'Invoice sale',$6)`,
              [req.user.companyId, item.productId, productResult.rows[0].name, item.quantity, id, req.user.email]
            )
            await client.query(
              `UPDATE stock_levels SET current_quantity = GREATEST(0, current_quantity - $1), last_updated_at = NOW()
               WHERE product_id = $2 AND company_id = $3`,
              [item.quantity, item.productId, req.user.companyId]
            )
          }
        }
      }
    }

    await client.query('COMMIT')

    const updatedInvoice = await pool.query(
      'SELECT * FROM invoices WHERE id = $1',
      [id]
    )
    const updatedItems = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [id])

    res.json({ data: { ...updatedInvoice.rows[0], items: updatedItems.rows } })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

export async function deleteInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE invoices SET invoice_status = 'CANCELLED', updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id, invoice_number, invoice_status`,
      [req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    res.json({ data: result.rows[0], message: 'Invoice cancelled' })
  } catch (err) {
    next(err)
  }
}

export async function generatePDF(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.companyId]
    )

    if (invoiceResult.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    const invoice = invoiceResult.rows[0]

    const itemsResult = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [req.params.id]
    )

    const companyResult = await pool.query(
      'SELECT * FROM companies WHERE id = $1',
      [req.user.companyId]
    )
    const company = companyResult.rows[0]

    const paymentsResult = await pool.query(
      'SELECT SUM(amount) as total_paid FROM payments WHERE invoice_id = $1',
      [req.params.id]
    )

    const pdfData = {
      company: {
        name: company.name,
        gstin: company.gstin,
        pan: company.pan,
        address: company.address,
        contactEmail: company.contact_email,
        contactPhone: company.contact_phone,
        bankDetails: company.bank_details,
      },
      invoice: {
        invoiceNumber: invoice.invoice_number,
        invoiceDate: invoice.invoice_date instanceof Date
          ? invoice.invoice_date.toLocaleDateString('en-IN')
          : String(invoice.invoice_date),
        dueDate: invoice.due_date
          ? invoice.due_date instanceof Date
            ? invoice.due_date.toLocaleDateString('en-IN')
            : String(invoice.due_date)
          : undefined,
        paymentTerms: invoice.payment_terms,
        isInterState: invoice.is_inter_state,
        notes: invoice.notes,
      },
      customer: {
        name: invoice.customer_name,
        gstin: invoice.customer_gstin,
        billingAddress: invoice.customer_address,
      },
      items: itemsResult.rows.map((item: any, idx: number) => ({
        srNo: idx + 1,
        productName: item.product_name,
        hsnCode: item.hsn_code,
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        rate: parseFloat(item.rate),
        discountPercent: parseFloat(item.discount_percent),
        discountAmount: parseFloat(item.discount_amount),
        amount: parseFloat(item.amount),
        taxRate: parseFloat(item.tax_rate),
        taxAmount: parseFloat(item.tax_amount),
        sgstAmount: parseFloat(item.sgst_amount),
        cgstAmount: parseFloat(item.cgst_amount),
        igstAmount: parseFloat(item.igst_amount),
        total: parseFloat(item.total),
      })),
      summary: {
        subtotal: parseFloat(invoice.subtotal),
        totalDiscount: parseFloat(invoice.total_discount),
        taxableAmount: parseFloat(invoice.taxable_amount),
        sgstAmount: parseFloat(invoice.sgst_amount),
        cgstAmount: parseFloat(invoice.cgst_amount),
        igstAmount: parseFloat(invoice.igst_amount),
        totalTax: parseFloat(invoice.total_tax),
        roundOff: parseFloat(invoice.round_off),
        finalAmount: parseFloat(invoice.final_amount),
        amountPaid: parseFloat(paymentsResult.rows[0]?.total_paid || 0),
      },
    }

    const pdfBuffer = await generateInvoicePDF(pdfData)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${invoice.invoice_number}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.send(pdfBuffer)
  } catch (err) {
    next(err)
  }
}

export async function sendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { to, cc } = req.body

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
      [req.params.id, req.user.companyId]
    )

    if (invoiceResult.rows.length === 0) {
      throw new AppError('Invoice not found', 404)
    }

    const invoice = invoiceResult.rows[0]
    const emailTo = to || invoice.customer_email

    if (!emailTo) {
      throw new AppError('No email address provided', 400)
    }

    const itemsResult = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1',
      [req.params.id]
    )

    const companyResult = await pool.query(
      'SELECT * FROM companies WHERE id = $1',
      [req.user.companyId]
    )
    const company = companyResult.rows[0]

    const paymentsResult = await pool.query(
      'SELECT SUM(amount) as total_paid FROM payments WHERE invoice_id = $1',
      [req.params.id]
    )

    const pdfData = {
      company: {
        name: company.name,
        gstin: company.gstin,
        pan: company.pan,
        address: company.address,
        contactEmail: company.contact_email,
        contactPhone: company.contact_phone,
        bankDetails: company.bank_details,
      },
      invoice: {
        invoiceNumber: invoice.invoice_number,
        invoiceDate: String(invoice.invoice_date),
        dueDate: invoice.due_date ? String(invoice.due_date) : undefined,
        paymentTerms: invoice.payment_terms,
        isInterState: invoice.is_inter_state,
        notes: invoice.notes,
      },
      customer: {
        name: invoice.customer_name,
        gstin: invoice.customer_gstin,
        billingAddress: invoice.customer_address,
      },
      items: itemsResult.rows.map((item: any, idx: number) => ({
        srNo: idx + 1,
        productName: item.product_name,
        hsnCode: item.hsn_code,
        quantity: parseFloat(item.quantity),
        unit: item.unit,
        rate: parseFloat(item.rate),
        discountPercent: parseFloat(item.discount_percent),
        discountAmount: parseFloat(item.discount_amount),
        amount: parseFloat(item.amount),
        taxRate: parseFloat(item.tax_rate),
        taxAmount: parseFloat(item.tax_amount),
        sgstAmount: parseFloat(item.sgst_amount),
        cgstAmount: parseFloat(item.cgst_amount),
        igstAmount: parseFloat(item.igst_amount),
        total: parseFloat(item.total),
      })),
      summary: {
        subtotal: parseFloat(invoice.subtotal),
        totalDiscount: parseFloat(invoice.total_discount),
        taxableAmount: parseFloat(invoice.taxable_amount),
        sgstAmount: parseFloat(invoice.sgst_amount),
        cgstAmount: parseFloat(invoice.cgst_amount),
        igstAmount: parseFloat(invoice.igst_amount),
        totalTax: parseFloat(invoice.total_tax),
        roundOff: parseFloat(invoice.round_off),
        finalAmount: parseFloat(invoice.final_amount),
        amountPaid: parseFloat(paymentsResult.rows[0]?.total_paid || 0),
      },
    }

    const pdfBuffer = await generateInvoicePDF(pdfData)

    await sendInvoiceEmail({
      to: emailTo,
      customerName: invoice.customer_name,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: String(invoice.invoice_date),
      dueDate: invoice.due_date ? String(invoice.due_date) : undefined,
      finalAmount: parseFloat(invoice.final_amount),
      companyName: company.name,
      pdfBuffer,
    })

    // Update status to SENT if it was DRAFT
    if (invoice.invoice_status === 'DRAFT') {
      await pool.query(
        `UPDATE invoices SET invoice_status = 'SENT', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      )
    }

    res.json({ message: `Invoice sent to ${emailTo}` })
  } catch (err) {
    next(err)
  }
}
