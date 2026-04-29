import dotenv from 'dotenv'
dotenv.config()

import app from './app'

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`InvoicePro API running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})
