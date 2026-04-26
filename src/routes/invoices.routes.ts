import { Router } from 'express'
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  generatePDF,
  sendEmail,
} from '../controllers/invoices.controller'

const router = Router()

router.get('/', listInvoices)
router.get('/:id', getInvoice)
router.get('/:id/pdf', generatePDF)
router.post('/', createInvoice)
router.post('/:id/send-email', sendEmail)
router.put('/:id', updateInvoice)
router.delete('/:id', deleteInvoice)

export default router
