import { Router } from 'express'
import { getCompany, updateCompany } from '../controllers/companies.controller'
import { requireRole } from '../middleware/auth'

const router = Router()

router.get('/', getCompany)
router.put('/', requireRole('ADMIN'), updateCompany)

export default router
