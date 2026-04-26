import { Router } from 'express'
import {
  getSummary,
  getProductStock,
  stockIn,
  stockOut,
  stockAdjust,
  listTransactions,
  getLowStockItems,
  getValuation,
  updateThresholds,
} from '../controllers/stock.controller'

const router = Router()

router.get('/summary', getSummary)
router.get('/low-items', getLowStockItems)
router.get('/valuation', getValuation)
router.get('/transactions', listTransactions)
router.get('/:productId', getProductStock)
router.put('/:productId/thresholds', updateThresholds)
router.post('/in', stockIn)
router.post('/out', stockOut)
router.post('/adjust', stockAdjust)

export default router
