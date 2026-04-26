import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import {
  register,
  login,
  refreshToken,
  logout,
  me,
  registerSchema,
  loginSchema,
} from '../controllers/auth.controller'
import { z } from 'zod'

const router = Router()

const refreshSchema = z.object({
  refreshToken: z.string(),
})

router.post('/register', validate(registerSchema), register)
router.post('/login', validate(loginSchema), login)
router.post('/refresh', validate(refreshSchema), refreshToken)
router.post('/logout', authenticate, logout)
router.get('/me', authenticate, me)

export default router
