import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export interface SendInvoiceEmailOptions {
  to: string
  customerName: string
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  finalAmount: number
  companyName: string
  pdfBuffer: Buffer
}

export async function sendInvoiceEmail(opts: SendInvoiceEmailOptions): Promise<void> {
  const {
    to,
    customerName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    finalAmount,
    companyName,
    pdfBuffer,
  } = opts

  const dueDateText = dueDate ? `<p><strong>Due Date:</strong> ${dueDate}</p>` : ''

  await transporter.sendMail({
    from: `${companyName} <${process.env.FROM_EMAIL || 'noreply@invoicepro.in'}>`,
    to,
    subject: `Invoice ${invoiceNumber} from ${companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Invoice from ${companyName}</h2>
        <p>Dear ${customerName},</p>
        <p>Please find attached your invoice details:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Invoice Number:</strong> ${invoiceNumber}</p>
          <p><strong>Invoice Date:</strong> ${invoiceDate}</p>
          ${dueDateText}
          <p><strong>Amount Due:</strong> ₹${finalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <p>Please find the invoice PDF attached to this email.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <br/>
        <p>Thank you for your business!</p>
        <p><strong>${companyName}</strong></p>
        <hr style="border: 1px solid #e5e7eb; margin: 24px 0;"/>
        <p style="color: #6b7280; font-size: 12px;">This is an automated email from InvoicePro. Please do not reply directly to this email.</p>
      </div>
    `,
    attachments: [
      {
        filename: `Invoice_${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>
}): Promise<void> {
  await transporter.sendMail({
    from: process.env.FROM_EMAIL || 'noreply@invoicepro.in',
    ...opts,
  })
}
