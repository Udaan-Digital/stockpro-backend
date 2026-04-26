import { Router } from 'express'
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  receiveGRN,
} from '../controllers/purchaseOrders.controller'

const router = Router()

router.get('/', listPurchaseOrders)
router.get('/:id', getPurchaseOrder)
router.post('/', createPurchaseOrder)
router.post('/:id/receive', receiveGRN)
router.put('/:id', updatePurchaseOrder)
router.delete('/:id', deletePurchaseOrder)

export default router
