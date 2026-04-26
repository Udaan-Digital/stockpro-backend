export interface ItemTotals {
  amount: number
  discountAmount: number
  taxableAmount: number
  taxAmount: number
  sgstAmount: number
  cgstAmount: number
  igstAmount: number
  total: number
}

export interface InvoiceSummary {
  subtotal: number
  totalDiscount: number
  taxableAmount: number
  sgstAmount: number
  cgstAmount: number
  igstAmount: number
  totalTax: number
  roundOff: number
  finalAmount: number
}

export function calculateItemTotals(
  rate: number,
  qty: number,
  discPct: number,
  taxRate: number,
  isInterState: boolean
): ItemTotals {
  const amount = parseFloat((rate * qty).toFixed(2))
  const discountAmount = parseFloat(((amount * discPct) / 100).toFixed(2))
  const taxableAmount = parseFloat((amount - discountAmount).toFixed(2))
  const taxAmount = parseFloat(((taxableAmount * taxRate) / 100).toFixed(2))

  let sgstAmount = 0
  let cgstAmount = 0
  let igstAmount = 0

  if (isInterState) {
    igstAmount = taxAmount
  } else {
    sgstAmount = parseFloat((taxAmount / 2).toFixed(2))
    cgstAmount = parseFloat((taxAmount - sgstAmount).toFixed(2))
  }

  const total = parseFloat((taxableAmount + taxAmount).toFixed(2))

  return {
    amount,
    discountAmount,
    taxableAmount,
    taxAmount,
    sgstAmount,
    cgstAmount,
    igstAmount,
    total,
  }
}

export interface InvoiceItemInput {
  rate: number
  quantity: number
  discountPercent: number
  taxRate: number
}

export function calculateInvoiceSummary(
  items: InvoiceItemInput[],
  isInterState: boolean
): InvoiceSummary {
  let subtotal = 0
  let totalDiscount = 0
  let taxableAmount = 0
  let sgstAmount = 0
  let cgstAmount = 0
  let igstAmount = 0
  let totalTax = 0

  for (const item of items) {
    const totals = calculateItemTotals(
      item.rate,
      item.quantity,
      item.discountPercent,
      item.taxRate,
      isInterState
    )
    subtotal += totals.amount
    totalDiscount += totals.discountAmount
    taxableAmount += totals.taxableAmount
    sgstAmount += totals.sgstAmount
    cgstAmount += totals.cgstAmount
    igstAmount += totals.igstAmount
    totalTax += totals.taxAmount
  }

  subtotal = parseFloat(subtotal.toFixed(2))
  totalDiscount = parseFloat(totalDiscount.toFixed(2))
  taxableAmount = parseFloat(taxableAmount.toFixed(2))
  sgstAmount = parseFloat(sgstAmount.toFixed(2))
  cgstAmount = parseFloat(cgstAmount.toFixed(2))
  igstAmount = parseFloat(igstAmount.toFixed(2))
  totalTax = parseFloat(totalTax.toFixed(2))

  const beforeRound = taxableAmount + totalTax
  const roundOff = parseFloat((Math.round(beforeRound) - beforeRound).toFixed(2))
  const finalAmount = parseFloat((beforeRound + roundOff).toFixed(2))

  return {
    subtotal,
    totalDiscount,
    taxableAmount,
    sgstAmount,
    cgstAmount,
    igstAmount,
    totalTax,
    roundOff,
    finalAmount,
  }
}
