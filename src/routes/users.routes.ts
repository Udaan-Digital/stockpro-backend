import { Router } from 'express'
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/users.controller'
import { requireRole } from '../middleware/auth'

const router = Router()

router.get('/', requireRole('ADMIN', 'MANAGER'), listUsers)
router.get('/:id', requireRole('ADMIN', 'MANAGER'), getUser)
router.post('/', requireRole('ADMIN'), createUser)
router.put('/:id', requireRole('ADMIN'), updateUser)
router.delete('/:id', requireRole('ADMIN'), deleteUser)

export default router
