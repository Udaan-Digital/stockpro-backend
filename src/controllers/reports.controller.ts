import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = req.user.companyId

    // Today's sales
    const todaySalesResult = await pool.query(
      `SELECT COALESCE(SUM(final_amount), 0) AS today_sales, COUNT(id) AS today_invoice_count
       FROM invoices
       WHERE company_id = $1 AND invoice_date = CURRENT_DATE AND invoice_status NOT IN ('CANCELLED', 'DRAFT')`,
      [companyId]
    )

    // Month revenue
    const monthRevenueResult = await pool.query(
      `SELECT COALESCE(SUM(final_amount), 0) AS month_revenue, COUNT(id) AS month_invoice_count
       FROM invoices
       WHERE company_id = $1
         AND EXTRACT(MONTH FROM invoice_date) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(YEAR FROM invoice_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND invoice_status NOT IN ('CANCELLED', 'DRAFT')`,
      [companyId]
    )

    // Outstanding (unpaid + partial)
    const outstandingResult = await pool.query(
      `SELECT COALESCE(SUM(final_amount - amount_paid), 0) AS outstanding_amount, COUNT(id) AS outstanding_count
       FROM invoices
       WHERE company_id = $1 AND payment_status IN ('UNPAID', 'PARTIAL') AND invoice_status NOT IN ('CANCELLED')`,
      [companyId]
    )

    // Overdue invoices
    const overdueResult = await pool.query(
      `SELECT COUNT(id) AS overdue_count, COALESCE(SUM(final_amount - amount_paid), 0) AS overdue_amount
       FROM invoices
       WHERE company_id = $1
         AND payment_status IN ('UNPAID', 'PARTIAL')
         AND invoice_status NOT IN ('CANCELLED')
         AND due_date < CURRENT_DATE`,
      [companyId]
    )

    // Stock value
    const stockValueResult = await pool.query(
      `SELECT COALESCE(SUM(sl.current_quantity * p.cost_price), 0) AS stock_value
       FROM products p
       JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true`,
      [companyId]
    )

    // Low stock count
    const lowStockResult = await pool.query(
      `SELECT COUNT(*) AS low_stock_count
       FROM products p
       JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true AND sl.current_quantity <= sl.min_threshold`,
      [companyId]
    )

    // Recent invoices
    const recentInvoicesResult = await pool.query(
      `SELECT id, invoice_number, customer_name, invoice_date, final_amount, payment_status, invoice_status
       FROM invoices WHERE company_id = $1 AND invoice_status != 'CANCELLED'
       ORDER BY created_at DESC LIMIT 5`,
      [companyId]
    )

    res.json({
      data: {
        todaySales: parseFloat(todaySalesResult.rows[0].today_sales),
        todayInvoiceCount: parseInt(todaySalesResult.rows[0].today_invoice_count, 10),
        monthRevenue: parseFloat(monthRevenueResult.rows[0].month_revenue),
        monthInvoiceCount: parseInt(monthRevenueResult.rows[0].month_invoice_count, 10),
        outstandingAmount: parseFloat(outstandingResult.rows[0].outstanding_amount),
        outstandingCount: parseInt(outstandingResult.rows[0].outstanding_count, 10),
        overdueCount: parseInt(overdueResult.rows[0].overdue_count, 10),
        overdueAmount: parseFloat(overdueResult.rows[0].overdue_amount),
        stockValue: parseFloat(stockValueResult.rows[0].stock_value),
        lowStockCount: parseInt(lowStockResult.rows[0].low_stock_count, 10),
        recentInvoices: recentInvoicesResult.rows,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getSalesSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { groupBy = 'daily', from, to } = req.query

    let dateTrunc: string
    switch (groupBy) {
      case 'weekly':
        dateTrunc = 'week'
        break
      case 'monthly':
        dateTrunc = 'month'
        break
      default:
        dateTrunc = 'day'
    }

    const conditions: string[] = ['company_id = $1', "invoice_status NOT IN ('CANCELLED', 'DRAFT')"]
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (from) {
      conditions.push(`invoice_date >= $${paramIdx}`)
      params.push(from)
      paramIdx++
    }
    if (to) {
      conditions.push(`invoice_date <= $${paramIdx}`)
      params.push(to)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const result = await pool.query(
      `SELECT
         DATE_TRUNC('${dateTrunc}', invoice_date)::date AS period,
         COUNT(id) AS invoice_count,
         SUM(final_amount) AS revenue,
         SUM(total_tax) AS tax_collected,
         SUM(taxable_amount) AS taxable_amount
       FROM invoices
       WHERE ${where}
       GROUP BY DATE_TRUNC('${dateTrunc}', invoice_date)
       ORDER BY period ASC`,
      params
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function getTopCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to, limit: queryLimit } = req.query
    const limit = parseInt(queryLimit as string) || 10

    const conditions: string[] = ['i.company_id = $1', "i.invoice_status NOT IN ('CANCELLED', 'DRAFT')"]
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (from) {
      conditions.push(`i.invoice_date >= $${paramIdx}`)
      params.push(from)
      paramIdx++
    }
    if (to) {
      conditions.push(`i.invoice_date <= $${paramIdx}`)
      params.push(to)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const result = await pool.query(
      `SELECT
         i.customer_id,
         i.customer_name,
         COUNT(i.id) AS invoice_count,
         SUM(i.final_amount) AS total_revenue,
         SUM(i.final_amount - i.amount_paid) AS outstanding,
         MAX(i.invoice_date) AS last_invoice_date
       FROM invoices i
       WHERE ${where}
       GROUP BY i.customer_id, i.customer_name
       ORDER BY total_revenue DESC
       LIMIT $${paramIdx}`,
      [...params, limit]
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function getTopProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { from, to, limit: queryLimit } = req.query
    const limit = parseInt(queryLimit as string) || 10

    const conditions: string[] = ['i.company_id = $1', "i.invoice_status NOT IN ('CANCELLED', 'DRAFT')"]
    const params: any[] = [req.user.companyId]
    let paramIdx = 2

    if (from) {
      conditions.push(`i.invoice_date >= $${paramIdx}`)
      params.push(from)
      paramIdx++
    }
    if (to) {
      conditions.push(`i.invoice_date <= $${paramIdx}`)
      params.push(to)
      paramIdx++
    }

    const where = conditions.join(' AND ')

    const result = await pool.query(
      `SELECT
         ii.product_id,
         ii.product_name,
         SUM(ii.quantity) AS total_quantity_sold,
         SUM(ii.total) AS total_revenue,
         COUNT(DISTINCT i.id) AS invoice_count,
         AVG(ii.rate) AS avg_rate
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${where}
       GROUP BY ii.product_id, ii.product_name
       ORDER BY total_quantity_sold DESC
       LIMIT $${paramIdx}`,
      [...params, limit]
    )

    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
}

export async function getOutstandingInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         id, invoice_number, customer_name, invoice_date, due_date,
         final_amount, amount_paid, (final_amount - amount_paid) AS balance_due,
         payment_status, invoice_status,
         CURRENT_DATE - due_date AS days_overdue,
         CASE
           WHEN due_date IS NULL OR due_date >= CURRENT_DATE THEN '0-30'
           WHEN CURRENT_DATE - due_date <= 30 THEN '0-30'
           WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
           ELSE '60+'
         END AS aging_bucket
       FROM invoices
       WHERE company_id = $1
         AND payment_status IN ('UNPAID', 'PARTIAL')
         AND invoice_status NOT IN ('CANCELLED')
       ORDER BY due_date ASC NULLS LAST`,
      [req.user.companyId]
    )

    // Group by aging bucket
    const buckets: Record<string, any[]> = { '0-30': [], '31-60': [], '60+': [] }
    for (const row of result.rows) {
      const bucket = row.aging_bucket
      if (buckets[bucket]) {
        buckets[bucket].push(row)
      }
    }

    const summary = {
      '0-30': {
        count: buckets['0-30'].length,
        amount: buckets['0-30'].reduce((s, r) => s + parseFloat(r.balance_due), 0),
      },
      '31-60': {
        count: buckets['31-60'].length,
        amount: buckets['31-60'].reduce((s, r) => s + parseFloat(r.balance_due), 0),
      },
      '60+': {
        count: buckets['60+'].length,
        amount: buckets['60+'].reduce((s, r) => s + parseFloat(r.balance_due), 0),
      },
    }

    res.json({
      data: {
        invoices: result.rows,
        agingSummary: summary,
        total: {
          count: result.rows.length,
          amount: result.rows.reduce((s, r) => s + parseFloat(r.balance_due), 0),
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getStockValue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(p.category, 'Uncategorized') AS category,
         COUNT(p.id) AS product_count,
         SUM(sl.current_quantity) AS total_quantity,
         SUM(sl.current_quantity * p.cost_price) AS cost_value,
         SUM(sl.current_quantity * p.selling_price) AS selling_value,
         SUM(sl.current_quantity * (p.selling_price - p.cost_price)) AS potential_profit
       FROM products p
       JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true
       GROUP BY COALESCE(p.category, 'Uncategorized')
       ORDER BY cost_value DESC`,
      [req.user.companyId]
    )

    const totalsResult = await pool.query(
      `SELECT
         SUM(sl.current_quantity * p.cost_price) AS total_cost_value,
         SUM(sl.current_quantity * p.selling_price) AS total_selling_value
       FROM products p
       JOIN stock_levels sl ON sl.product_id = p.id AND sl.company_id = p.company_id
       WHERE p.company_id = $1 AND p.is_active = true`,
      [req.user.companyId]
    )

    res.json({
      data: {
        byCategory: result.rows,
        totals: totalsResult.rows[0],
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getTaxSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { year } = req.query
    const yearNum = parseInt(year as string) || new Date().getFullYear()

    const result = await pool.query(
      `SELECT
         EXTRACT(MONTH FROM invoice_date)::int AS month,
         SUM(taxable_amount) AS taxable_amount,
         SUM(sgst_amount) AS sgst_amount,
         SUM(cgst_amount) AS cgst_amount,
         SUM(igst_amount) AS igst_amount,
         SUM(total_tax) AS total_tax,
         SUM(final_amount) AS revenue,
         COUNT(id) AS invoice_count
       FROM invoices
       WHERE company_id = $1
         AND EXTRACT(YEAR FROM invoice_date) = $2
         AND invoice_status NOT IN ('CANCELLED', 'DRAFT')
       GROUP BY EXTRACT(MONTH FROM invoice_date)
       ORDER BY month ASC`,
      [req.user.companyId, yearNum]
    )

    res.json({
      data: {
        year: yearNum,
        monthly: result.rows,
        totals: result.rows.reduce(
          (acc, row) => ({
            taxableAmount: acc.taxableAmount + parseFloat(row.taxable_amount || 0),
            sgstAmount: acc.sgstAmount + parseFloat(row.sgst_amount || 0),
            cgstAmount: acc.cgstAmount + parseFloat(row.cgst_amount || 0),
            igstAmount: acc.igstAmount + parseFloat(row.igst_amount || 0),
            totalTax: acc.totalTax + parseFloat(row.total_tax || 0),
            revenue: acc.revenue + parseFloat(row.revenue || 0),
          }),
          { taxableAmount: 0, sgstAmount: 0, cgstAmount: 0, igstAmount: 0, totalTax: 0, revenue: 0 }
        ),
      },
    })
  } catch (err) {
    next(err)
  }
}
