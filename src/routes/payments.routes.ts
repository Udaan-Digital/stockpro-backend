import { Router } from 'express'
import {
  createPayment,
  getInvoicePayments,
  listPayments,
  updatePayment,
  deletePayment,
} from '../controllers/payments.controller'

const router = Router()

router.get('/', listPayments)
router.get('/invoice/:invoiceId', getInvoicePayments)
router.post('/', createPayment)
router.put('/:id', updatePayment)
router.delete('/:id', deletePayment)

export default router
