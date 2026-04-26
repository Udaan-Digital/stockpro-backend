import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT id, name, gstin, pan, state, state_code, tax_regime FROM companies WHERE id = $1',
      [req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Company not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { gstin, pan, taxRegime, state, stateCode } = req.body

    const result = await pool.query(
      `UPDATE companies SET
        gstin = COALESCE($1, gstin),
        pan = COALESCE($2, pan),
        tax_regime = COALESCE($3, tax_regime),
        state = COALESCE($4, state),
        state_code = COALESCE($5, state_code),
        updated_at = NOW()
      WHERE id = $6
      RETURNING id, name, gstin, pan, state, state_code, tax_regime`,
      [gstin || null, pan || null, taxRegime || null, state || null, stateCode || null, req.user.companyId]
    )

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function generateGSTR1(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { month, year } = req.query

    if (!month || !year) {
      throw new AppError('month and year query params are required', 400)
    }

    const monthNum = parseInt(month as string, 10)
    const yearNum = parseInt(year as string, 10)

    // B2B: invoices with GSTIN (inter-business)
    const b2bResult = await pool.query(
      `SELECT
         i.customer_gstin,
         i.customer_name,
         COUNT(i.id) AS invoice_count,
         SUM(i.taxable_amount) AS taxable_amount,
         SUM(i.igst_amount) AS igst_amount,
         SUM(i.cgst_amount) AS cgst_amount,
         SUM(i.sgst_amount) AS sgst_amount,
         SUM(i.total_tax) AS total_tax,
         SUM(i.final_amount) AS total_amount,
         json_agg(json_build_object(
           'invoiceNumber', i.invoice_number,
           'invoiceDate', i.invoice_date,
           'taxableAmount', i.taxable_amount,
           'igstAmount', i.igst_amount,
           'cgstAmount', i.cgst_amount,
           'sgstAmount', i.sgst_amount,
           'totalTax', i.total_tax,
           'finalAmount', i.final_amount,
           'isInterState', i.is_inter_state
         )) AS invoices
       FROM invoices i
       WHERE i.company_id = $1
         AND EXTRACT(MONTH FROM i.invoice_date) = $2
         AND EXTRACT(YEAR FROM i.invoice_date) = $3
         AND i.invoice_status NOT IN ('CANCELLED', 'DRAFT')
         AND i.customer_gstin IS NOT NULL AND i.customer_gstin != ''
       GROUP BY i.customer_gstin, i.customer_name
       ORDER BY i.customer_name`,
      [req.user.companyId, monthNum, yearNum]
    )

    // B2C: invoices without GSTIN
    const b2cResult = await pool.query(
      `SELECT
         SUM(i.taxable_amount) AS taxable_amount,
         SUM(i.igst_amount) AS igst_amount,
         SUM(i.cgst_amount) AS cgst_amount,
         SUM(i.sgst_amount) AS sgst_amount,
         SUM(i.total_tax) AS total_tax,
         SUM(i.final_amount) AS total_amount,
         COUNT(i.id) AS invoice_count
       FROM invoices i
       WHERE i.company_id = $1
         AND EXTRACT(MONTH FROM i.invoice_date) = $2
         AND EXTRACT(YEAR FROM i.invoice_date) = $3
         AND i.invoice_status NOT IN ('CANCELLED', 'DRAFT')
         AND (i.customer_gstin IS NULL OR i.customer_gstin = '')`,
      [req.user.companyId, monthNum, yearNum]
    )

    res.json({
      data: {
        period: { month: monthNum, year: yearNum },
        b2b: b2bResult.rows,
        b2c: b2cResult.rows[0],
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getTaxSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { month, year } = req.query

    if (!month || !year) {
      throw new AppError('month and year query params are required', 400)
    }

    const monthNum = parseInt(month as string, 10)
    const yearNum = parseInt(year as string, 10)

    const result = await pool.query(
      `SELECT
         SUM(taxable_amount) AS total_taxable,
         SUM(sgst_amount) AS total_sgst,
         SUM(cgst_amount) AS total_cgst,
         SUM(igst_amount) AS total_igst,
         SUM(total_tax) AS total_output_tax,
         SUM(final_amount) AS total_revenue,
         COUNT(id) AS invoice_count
       FROM invoices
       WHERE company_id = $1
         AND EXTRACT(MONTH FROM invoice_date) = $2
         AND EXTRACT(YEAR FROM invoice_date) = $3
         AND invoice_status NOT IN ('CANCELLED', 'DRAFT')`,
      [req.user.companyId, monthNum, yearNum]
    )

    // ITC (Input Tax Credit)
    const itcResult = await pool.query(
      `SELECT COALESCE(SUM(itc_amount), 0) AS total_itc
       FROM vendor_invoices
       WHERE company_id = $1
         AND EXTRACT(MONTH FROM invoice_date) = $2
         AND EXTRACT(YEAR FROM invoice_date) = $3
         AND status = 'APPROVED'`,
      [req.user.companyId, monthNum, yearNum]
    )

    const outputTax = parseFloat(result.rows[0].total_output_tax || 0)
    const inputTax = parseFloat(itcResult.rows[0].total_itc || 0)

    res.json({
      data: {
        period: { month: monthNum, year: yearNum },
        outputTax: result.rows[0],
        inputTaxCredit: itcResult.rows[0].total_itc,
        netTaxPayable: outputTax - inputTax,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function listVendorInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const conditions: string[] = ['vi.company_id = $1']
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (req.query.status) {
      conditions.push(`vi.status = $${paramIdx}`)
      params.push(req.query.status)
      paramIdx++
    }

    if (req.query.supplierId) {
      conditions.push(`vi.supplier_id = $${paramIdx}`)
      params.push(req.query.supplierId)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM vendor_invoices vi WHERE ${where}`,
      params
    )
    const total = parseInt(countResult.rows[0].count, 10)

    const result = await pool.query(
      `SELECT vi.*, s.name AS supplier_name
       FROM vendor_invoices vi
       LEFT JOIN suppliers s ON s.id = vi.supplier_id
       WHERE ${where}
       ORDER BY vi.invoice_date DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    )

    res.json({ data: result.rows, meta: { total, page, limit } })
  } catch (err) {
    next(err)
  }
}

export async function createVendorInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { supplierId, invoiceNumber, invoiceDate, invoiceAmount, gstAmount, itcAmount, documentUrl } = req.body

    const result = await pool.query(
      `INSERT INTO vendor_invoices (company_id, supplier_id, invoice_number, invoice_date, invoice_amount, gst_amount, itc_amount, document_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user.companyId,
        supplierId || null,
        invoiceNumber,
        invoiceDate || new Date().toISOString().split('T')[0],
        invoiceAmount || 0,
        gstAmount || 0,
        itcAmount || gstAmount || 0,
        documentUrl || null,
      ]
    )

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function updateVendorInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, itcAmount, documentUrl } = req.body

    const result = await pool.query(
      `UPDATE vendor_invoices SET
        status = COALESCE($1, status),
        itc_amount = COALESCE($2, itc_amount),
        document_url = COALESCE($3, document_url),
        updated_at = NOW()
      WHERE id = $4 AND company_id = $5 RETURNING *`,
      [status || null, itcAmount ?? null, documentUrl || null, req.params.id, req.user.companyId]
    )

    if (result.rows.length === 0) {
      throw new AppError('Vendor invoice not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}

export async function getITCBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(itc_amount), 0) AS total_itc_available,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN itc_amount ELSE 0 END), 0) AS approved_itc,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN itc_amount ELSE 0 END), 0) AS pending_itc,
         COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS approved_count,
         COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count,
         COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) AS rejected_count
       FROM vendor_invoices
       WHERE company_id = $1`,
      [req.user.companyId]
    )

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}
