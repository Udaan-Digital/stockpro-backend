import { Router } from 'express'
import { authenticate } from '../middleware/auth'

import authRoutes from './auth.routes'
import companiesRoutes from './companies.routes'
import usersRoutes from './users.routes'
import customersRoutes from './customers.routes'
import productsRoutes from './products.routes'
import stockRoutes from './stock.routes'
import invoicesRoutes from './invoices.routes'
import paymentsRoutes from './payments.routes'
import suppliersRoutes from './suppliers.routes'
import purchaseOrdersRoutes from './purchaseOrders.routes'
import gstRoutes from './gst.routes'
import reportsRoutes from './reports.routes'

const router = Router()

// Public routes
router.use('/auth', authRoutes)

// Protected routes — all require authentication
router.use('/companies', authenticate, companiesRoutes)
router.use('/users', authenticate, usersRoutes)
router.use('/customers', authenticate, customersRoutes)
router.use('/products', authenticate, productsRoutes)
router.use('/stock', authenticate, stockRoutes)
router.use('/invoices', authenticate, invoicesRoutes)
router.use('/payments', authenticate, paymentsRoutes)
router.use('/suppliers', authenticate, suppliersRoutes)
router.use('/purchase-orders', authenticate, purchaseOrdersRoutes)
router.use('/gst', authenticate, gstRoutes)
router.use('/reports', authenticate, reportsRoutes)

export default router
