import { Router } from 'express'
import {
  getConfig,
  updateConfig,
  generateGSTR1,
  getTaxSummary,
  listVendorInvoices,
  createVendorInvoice,
  updateVendorInvoice,
  getITCBalance,
} from '../controllers/gst.controller'
import { requireRole } from '../middleware/auth'

const router = Router()

router.get('/config', getConfig)
router.put('/config', requireRole('ADMIN', 'ACCOUNTANT'), updateConfig)
router.get('/gstr1', generateGSTR1)
router.get('/tax-summary', getTaxSummary)
router.get('/vendor-invoices', listVendorInvoices)
router.post('/vendor-invoices', createVendorInvoice)
router.put('/vendor-invoices/:id', requireRole('ADMIN', 'ACCOUNTANT'), updateVendorInvoice)
router.get('/itc-balance', getITCBalance)

export default router
