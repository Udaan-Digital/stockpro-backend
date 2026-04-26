import PDFDocument from 'pdfkit'

export interface PdfInvoiceData {
  company: {
    name: string
    gstin?: string
    pan?: string
    address?: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      pincode?: string
    }
    contactEmail?: string
    contactPhone?: string
    bankDetails?: {
      bankName?: string
      accountNumber?: string
      ifscCode?: string
      accountName?: string
    }
  }
  invoice: {
    invoiceNumber: string
    invoiceDate: string
    dueDate?: string
    paymentTerms?: number
    isInterState: boolean
    notes?: string
  }
  customer: {
    name: string
    gstin?: string
    billingAddress?: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      pincode?: string
    }
    email?: string
    phone?: string
  }
  items: Array<{
    srNo: number
    productName: string
    hsnCode?: string
    quantity: number
    unit: string
    rate: number
    discountPercent: number
    discountAmount: number
    amount: number
    taxRate: number
    taxAmount: number
    sgstAmount: number
    cgstAmount: number
    igstAmount: number
    total: number
  }>
  summary: {
    subtotal: number
    totalDiscount: number
    taxableAmount: number
    sgstAmount: number
    cgstAmount: number
    igstAmount: number
    totalTax: number
    roundOff: number
    finalAmount: number
    amountPaid: number
  }
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatAddress(addr?: {
  line1?: string
  line2?: string
  city?: string
  state?: string
  pincode?: string
}): string {
  if (!addr) return ''
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean)
  return parts.join(', ')
}

export async function generateInvoicePDF(data: PdfInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Invoice ${data.invoice.invoiceNumber}`,
        Author: data.company.name,
      },
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width - 80 // margins
    const blue = '#1e40af'
    const gray = '#6b7280'
    const lightGray = '#f3f4f6'
    const darkGray = '#374151'

    // ── HEADER ──────────────────────────────────────────────
    doc.rect(40, 40, pageWidth, 80).fill(blue)

    doc.fill('white').fontSize(22).font('Helvetica-Bold')
       .text(data.company.name, 50, 55, { width: pageWidth / 2 })

    doc.fontSize(9).font('Helvetica')
    let companyY = 80
    if (data.company.gstin) {
      doc.text(`GSTIN: ${data.company.gstin}`, 50, companyY)
      companyY += 13
    }
    if (data.company.contactPhone) {
      doc.text(`Ph: ${data.company.contactPhone}`, 50, companyY)
      companyY += 13
    }
    if (data.company.contactEmail) {
      doc.text(data.company.contactEmail, 50, companyY)
    }

    // Invoice title on right
    doc.fill('white').fontSize(24).font('Helvetica-Bold')
       .text('TAX INVOICE', 40 + pageWidth / 2, 52, { width: pageWidth / 2, align: 'right' })

    doc.fontSize(10).font('Helvetica')
       .text(`Invoice No: ${data.invoice.invoiceNumber}`, 40 + pageWidth / 2, 80, { width: pageWidth / 2, align: 'right' })
       .text(`Date: ${data.invoice.invoiceDate}`, 40 + pageWidth / 2, 93, { width: pageWidth / 2, align: 'right' })

    if (data.invoice.dueDate) {
      doc.text(`Due: ${data.invoice.dueDate}`, 40 + pageWidth / 2, 106, { width: pageWidth / 2, align: 'right' })
    }

    // ── BILL TO / COMPANY ADDRESS ────────────────────────────
    doc.fill(darkGray)
    const infoY = 135

    // Left: Bill To
    doc.rect(40, infoY, pageWidth / 2 - 5, 90).fillAndStroke(lightGray, '#e5e7eb')
    doc.fill(blue).fontSize(9).font('Helvetica-Bold')
       .text('BILL TO', 50, infoY + 8)
    doc.fill(darkGray).fontSize(11).font('Helvetica-Bold')
       .text(data.customer.name, 50, infoY + 22)
    doc.fontSize(9).font('Helvetica')
    let custY = infoY + 37
    if (data.customer.gstin) {
      doc.text(`GSTIN: ${data.customer.gstin}`, 50, custY)
      custY += 13
    }
    const custAddr = formatAddress(data.customer.billingAddress)
    if (custAddr) {
      doc.text(custAddr, 50, custY, { width: pageWidth / 2 - 20 })
    }

    // Right: Company address
    const rightX = 40 + pageWidth / 2 + 5
    doc.rect(rightX, infoY, pageWidth / 2 - 5, 90).fillAndStroke(lightGray, '#e5e7eb')
    doc.fill(blue).fontSize(9).font('Helvetica-Bold')
       .text('FROM', rightX + 10, infoY + 8)
    doc.fill(darkGray).fontSize(9).font('Helvetica')
    const compAddr = formatAddress(data.company.address)
    if (compAddr) {
      doc.text(compAddr, rightX + 10, infoY + 22, { width: pageWidth / 2 - 25 })
    }
    if (data.company.pan) {
      doc.text(`PAN: ${data.company.pan}`, rightX + 10, infoY + 60)
    }

    // ── ITEMS TABLE ──────────────────────────────────────────
    const tableY = infoY + 100
    const isInterState = data.invoice.isInterState

    // Column definitions
    const cols = isInterState
      ? [
          { label: 'Sr', x: 40, width: 25 },
          { label: 'Item / Description', x: 65, width: 150 },
          { label: 'HSN', x: 215, width: 45 },
          { label: 'Qty', x: 260, width: 35 },
          { label: 'Unit', x: 295, width: 30 },
          { label: 'Rate', x: 325, width: 55 },
          { label: 'Disc%', x: 380, width: 40 },
          { label: 'Taxable', x: 420, width: 55 },
          { label: 'GST%', x: 475, width: 35 },
          { label: 'IGST', x: 510, width: 50 },
          { label: 'Total', x: 560, width: 55 },
        ]
      : [
          { label: 'Sr', x: 40, width: 25 },
          { label: 'Item / Description', x: 65, width: 145 },
          { label: 'HSN', x: 210, width: 40 },
          { label: 'Qty', x: 250, width: 30 },
          { label: 'Unit', x: 280, width: 28 },
          { label: 'Rate', x: 308, width: 50 },
          { label: 'Disc%', x: 358, width: 38 },
          { label: 'Taxable', x: 396, width: 50 },
          { label: 'GST%', x: 446, width: 32 },
          { label: 'CGST', x: 478, width: 44 },
          { label: 'SGST', x: 522, width: 44 },
          { label: 'Total', x: 566, width: 49 },
        ]

    // Header row
    doc.rect(40, tableY, pageWidth, 20).fill(blue)
    doc.fill('white').fontSize(8).font('Helvetica-Bold')
    for (const col of cols) {
      doc.text(col.label, col.x + 2, tableY + 6, { width: col.width - 4, align: 'right' })
    }

    // Item rows
    let rowY = tableY + 20
    const rowHeight = 18

    for (const item of data.items) {
      const bg = item.srNo % 2 === 0 ? lightGray : 'white'
      doc.rect(40, rowY, pageWidth, rowHeight).fill(bg)
      doc.fill(darkGray).fontSize(8).font('Helvetica')

      const values = isInterState
        ? [
            String(item.srNo),
            item.productName,
            item.hsnCode || '',
            String(item.quantity),
            item.unit,
            formatCurrency(item.rate),
            item.discountPercent ? `${item.discountPercent}%` : '-',
            formatCurrency(item.amount),
            `${item.taxRate}%`,
            formatCurrency(item.igstAmount),
            formatCurrency(item.total),
          ]
        : [
            String(item.srNo),
            item.productName,
            item.hsnCode || '',
            String(item.quantity),
            item.unit,
            formatCurrency(item.rate),
            item.discountPercent ? `${item.discountPercent}%` : '-',
            formatCurrency(item.amount),
            `${item.taxRate}%`,
            formatCurrency(item.cgstAmount),
            formatCurrency(item.sgstAmount),
            formatCurrency(item.total),
          ]

      for (let i = 0; i < cols.length; i++) {
        const align = i <= 1 ? 'left' : 'right'
        doc.text(values[i], cols[i].x + 2, rowY + 5, { width: cols[i].width - 4, align })
      }

      rowY += rowHeight
    }

    // Table bottom border
    doc.moveTo(40, rowY).lineTo(40 + pageWidth, rowY).stroke('#e5e7eb')

    // ── TOTALS ───────────────────────────────────────────────
    rowY += 10
    const totalsX = 40 + pageWidth - 220
    const labelWidth = 140
    const valueWidth = 75

    const addTotalRow = (label: string, value: string, bold = false, bgColor?: string) => {
      if (bgColor) {
        doc.rect(totalsX - 5, rowY - 2, 225, 16).fill(bgColor)
      }
      doc.fill(bold ? darkGray : gray)
         .fontSize(9)
         .font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .text(label, totalsX, rowY, { width: labelWidth, align: 'right' })
         .text(value, totalsX + labelWidth, rowY, { width: valueWidth, align: 'right' })
      rowY += 16
    }

    addTotalRow('Subtotal:', formatCurrency(data.summary.subtotal))
    if (data.summary.totalDiscount > 0) {
      addTotalRow('Total Discount:', `- ${formatCurrency(data.summary.totalDiscount)}`)
    }
    addTotalRow('Taxable Amount:', formatCurrency(data.summary.taxableAmount))

    if (isInterState) {
      addTotalRow(`IGST (${data.items[0]?.taxRate || 0}%):`, formatCurrency(data.summary.igstAmount))
    } else {
      addTotalRow('CGST:', formatCurrency(data.summary.cgstAmount))
      addTotalRow('SGST:', formatCurrency(data.summary.sgstAmount))
    }

    if (data.summary.roundOff !== 0) {
      addTotalRow('Round Off:', formatCurrency(data.summary.roundOff))
    }

    addTotalRow('Grand Total:', formatCurrency(data.summary.finalAmount), true, blue)
    doc.fill('white') // reset fill for grand total text
    doc.fill(blue).fontSize(9).font('Helvetica-Bold')
       .text('Grand Total:', totalsX, rowY - 16, { width: labelWidth, align: 'right' })
       .text(formatCurrency(data.summary.finalAmount), totalsX + labelWidth, rowY - 16, { width: valueWidth, align: 'right' })

    rowY += 4
    if (data.summary.amountPaid > 0) {
      doc.fill(darkGray)
      addTotalRow('Amount Paid:', formatCurrency(data.summary.amountPaid))
      const balance = data.summary.finalAmount - data.summary.amountPaid
      addTotalRow('Balance Due:', formatCurrency(balance), true)
    }

    // ── BANK DETAILS ─────────────────────────────────────────
    if (data.company.bankDetails?.bankName) {
      const bankY = rowY + 10
      doc.rect(40, bankY, pageWidth / 2 - 5, 70).fillAndStroke(lightGray, '#e5e7eb')
      doc.fill(blue).fontSize(9).font('Helvetica-Bold')
         .text('BANK DETAILS', 50, bankY + 8)
      doc.fill(darkGray).fontSize(9).font('Helvetica')
      let by = bankY + 22
      const bd = data.company.bankDetails
      if (bd.accountName) { doc.text(`Account Name: ${bd.accountName}`, 50, by); by += 13 }
      if (bd.bankName) { doc.text(`Bank: ${bd.bankName}`, 50, by); by += 13 }
      if (bd.accountNumber) { doc.text(`Account No: ${bd.accountNumber}`, 50, by); by += 13 }
      if (bd.ifscCode) { doc.text(`IFSC: ${bd.ifscCode}`, 50, by) }
    }

    // ── NOTES ────────────────────────────────────────────────
    if (data.invoice.notes) {
      const notesY = rowY + 10
      doc.fill(blue).fontSize(9).font('Helvetica-Bold')
         .text('NOTES', 40 + pageWidth / 2 + 5, notesY)
      doc.fill(gray).fontSize(9).font('Helvetica')
         .text(data.invoice.notes, 40 + pageWidth / 2 + 5, notesY + 15, { width: pageWidth / 2 - 5 })
    }

    // ── FOOTER ───────────────────────────────────────────────
    const footerY = doc.page.height - 60
    doc.moveTo(40, footerY).lineTo(40 + pageWidth, footerY).stroke('#e5e7eb')
    doc.fill(gray).fontSize(8).font('Helvetica')
       .text('This is a computer generated invoice and does not require a physical signature.', 40, footerY + 8, {
         width: pageWidth,
         align: 'center',
       })
    doc.text(`Generated by InvoicePro — ${new Date().toLocaleDateString('en-IN')}`, 40, footerY + 22, {
      width: pageWidth,
      align: 'center',
    })

    doc.end()
  })
}
