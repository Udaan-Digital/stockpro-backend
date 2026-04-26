import { Router } from 'express'
import {
  getDashboard,
  getSalesSummary,
  getTopCustomers,
  getTopProducts,
  getOutstandingInvoices,
  getStockValue,
  getTaxSummary,
} from '../controllers/reports.controller'

const router = Router()

router.get('/dashboard', getDashboard)
router.get('/sales', getSalesSummary)
router.get('/top-customers', getTopCustomers)
router.get('/top-products', getTopProducts)
router.get('/outstanding', getOutstandingInvoices)
router.get('/stock-value', getStockValue)
router.get('/tax-summary', getTaxSummary)

export default router
