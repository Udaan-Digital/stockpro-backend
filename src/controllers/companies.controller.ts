import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/database'
import { AppError } from '../middleware/errorHandler'

export async function getCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT * FROM companies WHERE id = $1',
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

const taxRegimeToDb: Record<string, string> = {
  NORMAL: 'regular', COMPOSITION: 'composition', UNREGISTERED: 'exempt',
  regular: 'regular', composition: 'composition', exempt: 'exempt',
}

export async function updateCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      name,
      gstin,
      pan,
      address,
      contactEmail,
      contactPhone,
      businessType,
      taxRegime,
      state,
      stateCode,
      invoicePrefix,
      logoUrl,
      bankDetails,
    } = req.body

    const dbTaxRegime = taxRegime ? (taxRegimeToDb[taxRegime] ?? taxRegime) : null

    const result = await pool.query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        gstin = COALESCE($2, gstin),
        pan = COALESCE($3, pan),
        address = COALESCE($4, address),
        contact_email = COALESCE($5, contact_email),
        contact_phone = COALESCE($6, contact_phone),
        business_type = COALESCE($7, business_type),
        tax_regime = COALESCE($8, tax_regime),
        state = COALESCE($9, state),
        state_code = COALESCE($10, state_code),
        invoice_prefix = COALESCE($11, invoice_prefix),
        logo_url = COALESCE($12, logo_url),
        bank_details = COALESCE($13, bank_details),
        updated_at = NOW()
      WHERE id = $14 RETURNING *`,
      [
        name || null,
        gstin || null,
        pan || null,
        address ? JSON.stringify(address) : null,
        contactEmail || null,
        contactPhone || null,
        businessType || null,
        dbTaxRegime,
        state || null,
        stateCode || null,
        invoicePrefix || null,
        logoUrl || null,
        bankDetails ? JSON.stringify(bankDetails) : null,
        req.user.companyId,
      ]
    )

    if (result.rows.length === 0) {
      throw new AppError('Company not found', 404)
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
}
