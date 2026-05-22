/**
 * Sales invoice field schema, validation, and GST auto-calculation.
 */

import {
  gstinStateCode,
  isNonEmpty,
  isValidGstin,
  isValidHsn,
  normalizeGstRate,
  parsePositiveNumber,
  splitQtyUnit,
  splitRate,
} from './validation.js'

export type InvoiceFieldKey =
  | 'invoice-no'
  | 'date'
  | 'party-name'
  | 'place-of-supply'
  | 'hsn-code'
  | 'item'
  | 'qty'
  | 'rate'
  | 'unit'
  | 'gst-rate'
  | 'customer-gstin'

export const REQUIRED_INVOICE_FIELDS: InvoiceFieldKey[] = [
  'invoice-no',
  'date',
  'party-name',
  'place-of-supply',
  'hsn-code',
  'item',
  'qty',
  'rate',
  'unit',
  'gst-rate',
]

export interface SalesInvoiceInput {
  company?: string
  companyGstin?: string
  sellerState?: string
  invoiceNo?: string
  date?: string
  partyName?: string
  placeOfSupply?: string
  customerGstin?: string
  hsnCode?: string
  item?: string
  qty?: string
  rate?: string
  unit?: string
  gstRate?: string
  billingAddress?: string
  discount?: number | string
  reverseCharge?: string
  b2b?: boolean
  voucherClass?: string
  narration?: string
}

export interface SalesInvoiceData {
  company?: string
  companyGstin?: string
  invoiceNo: string
  date: string
  partyName: string
  placeOfSupply: string
  placeOfSupplyCode: string
  customerGstin?: string
  billingAddress?: string
  reverseCharge: string
  discount: number
  item: string
  hsnCode: string
  qty: number
  unit: string
  rate: number
  gstRate: number
  totalValue: number
  cgst: number
  sgst: number
  igst: number
  taxTotal: number
  grandTotal: number
  isInterState: boolean
  voucherClass?: string
  narration?: string
  warnings: string[]
}

export interface ValidationErrorPayload {
  error: 'validation'
  message: string
  missing: InvoiceFieldKey[]
  warnings: string[]
}

export class InvoiceValidationError extends Error {
  readonly code = 'VALIDATION' as const
  readonly missing: InvoiceFieldKey[]
  readonly warnings: string[]

  constructor(missing: InvoiceFieldKey[], warnings: string[] = []) {
    super('Missing required invoice fields')
    this.name = 'InvoiceValidationError'
    this.missing = missing
    this.warnings = warnings
  }

  toJSON(): ValidationErrorPayload {
    return {
      error: 'validation',
      message: this.message,
      missing: this.missing,
      warnings: this.warnings,
    }
  }
}

/** Indian state name / code → 2-digit GST state code (subset) */
const STATE_TO_CODE: Record<string, string> = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  haryana: '06',
  delhi: '07',
  rajasthan: '08',
  'uttar pradesh': '09',
  up: '09',
  bihar: '10',
  sikkim: '11',
  'arunachal pradesh': '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  'west bengal': '19',
  jharkhand: '20',
  odisha: '21',
  orissa: '21',
  chhattisgarh: '22',
  'madhya pradesh': '23',
  mp: '23',
  gujarat: '24',
  'dadra and nagar haveli and daman and diu': '26',
  'dadra and nagar haveli': '26',
  'daman and diu': '26',
  maharashtra: '27',
  'andhra pradesh': '37',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  'tamil nadu': '33',
  puducherry: '34',
  pondicherry: '34',
  'andaman and nicobar': '35',
  telangana: '36',
  'andhra pradesh (new)': '37',
  ladakh: '38',
}

function resolveStateCode(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  const t = raw.trim()
  if (/^\d{2}$/.test(t)) return t
  const key = t.toLowerCase().replace(/\s+/g, ' ')
  return STATE_TO_CODE[key]
}

function resolveSellerStateCode(input: SalesInvoiceInput, warnings: string[]): string | undefined {
  if (input.companyGstin && isValidGstin(input.companyGstin)) {
    return gstinStateCode(input.companyGstin)
  }
  if (input.sellerState) {
    const c = resolveStateCode(input.sellerState)
    if (c) return c
  }
  warnings.push('seller-state not set; assumed intra-state CGST/SGST')
  return undefined
}

function resolveBuyerStateCode(input: SalesInvoiceInput): string | undefined {
  if (input.b2b && input.customerGstin && isValidGstin(input.customerGstin)) {
    return gstinStateCode(input.customerGstin)
  }
  return resolveStateCode(input.placeOfSupply)
}

function collectMissing(input: SalesInvoiceInput): InvoiceFieldKey[] {
  const missing: InvoiceFieldKey[] = []

  if (!isNonEmpty(input.invoiceNo)) missing.push('invoice-no')
  if (!isNonEmpty(input.date)) missing.push('date')
  if (!isNonEmpty(input.partyName)) missing.push('party-name')
  if (!isNonEmpty(input.placeOfSupply)) missing.push('place-of-supply')
  if (!isNonEmpty(input.hsnCode)) missing.push('hsn-code')
  if (!isNonEmpty(input.item)) missing.push('item')
  if (!isNonEmpty(input.qty) || parsePositiveNumber(input.qty) === undefined) missing.push('qty')
  if (!isNonEmpty(input.rate) || parsePositiveNumber(splitRate(input.rate ?? '')) === undefined)
    missing.push('rate')
  if (!isNonEmpty(input.unit)) missing.push('unit')
  if (!normalizeGstRate(input.gstRate)) missing.push('gst-rate')

  if (input.b2b && !isNonEmpty(input.customerGstin)) missing.push('customer-gstin')

  return missing
}

function normaliseDate(raw: string): string {
  const parts = raw.split(/[\/\-]/)
  if (parts.length === 3) {
    const [d, m, y] = parts
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.length === 2 ? `20${y}` : y}`
  }
  return raw
}

export function getMissingFields(input: SalesInvoiceInput): InvoiceFieldKey[] {
  return collectMissing(input)
}

export function validateAndCompute(input: SalesInvoiceInput): SalesInvoiceData {
  const warnings: string[] = []
  const missing = collectMissing(input)

  if (missing.length > 0) {
    throw new InvoiceValidationError(missing, warnings)
  }

  const hsn = input.hsnCode!.trim()
  if (!isValidHsn(hsn)) {
    throw new InvoiceValidationError([], [...warnings, `Invalid HSN code: ${hsn}`])
  }

  if (input.b2b && input.customerGstin && !isValidGstin(input.customerGstin)) {
    throw new InvoiceValidationError([], [...warnings, 'Invalid customer GSTIN format'])
  }

  const qty = parsePositiveNumber(input.qty!)!
  const rate = parsePositiveNumber(splitRate(input.rate!))!
  const gstRate = parseFloat(normalizeGstRate(input.gstRate!)!)
  const discount =
    typeof input.discount === 'number'
      ? input.discount
      : parsePositiveNumber(String(input.discount ?? '0')) ?? 0

  const totalValue = Math.max(0, qty * rate - discount)
  const taxAmount = (totalValue * gstRate) / 100

  const sellerCode = resolveSellerStateCode(input, warnings)
  const buyerCode = resolveBuyerStateCode(input)
  const posCode = resolveStateCode(input.placeOfSupply!) ?? buyerCode ?? ''

  let isInterState = false
  if (sellerCode && buyerCode) {
    isInterState = sellerCode !== buyerCode
  } else if (sellerCode && posCode) {
    isInterState = sellerCode !== posCode
  }

  let cgst = 0
  let sgst = 0
  let igst = 0

  if (isInterState) {
    igst = taxAmount
  } else {
    cgst = taxAmount / 2
    sgst = taxAmount / 2
  }

  const taxTotal = cgst + sgst + igst
  const grandTotal = totalValue + taxTotal

  return {
    company: input.company,
    companyGstin: input.companyGstin,
    invoiceNo: input.invoiceNo!.trim(),
    date: normaliseDate(input.date!.trim()),
    partyName: input.partyName!.trim(),
    placeOfSupply: input.placeOfSupply!.trim(),
    placeOfSupplyCode: posCode,
    customerGstin: input.customerGstin?.trim().toUpperCase(),
    billingAddress: input.billingAddress?.trim(),
    reverseCharge: /^y(es)?$/i.test(input.reverseCharge?.trim() ?? '') ? 'Yes' : 'No',
    discount,
    item: input.item!.trim(),
    hsnCode: hsn,
    qty,
    unit: input.unit!.trim(),
    rate,
    gstRate,
    totalValue,
    cgst,
    sgst,
    igst,
    taxTotal,
    grandTotal,
    isInterState,
    voucherClass: input.voucherClass,
    narration: input.narration,
    warnings,
  }
}

/** Map partial input from flags / parser into SalesInvoiceInput */
export function inputFromLegacyItem(item: {
  description: string
  hsn?: string
  qty: string
  rate: string
  taxRate: string
}): Partial<SalesInvoiceInput> {
  const {qty, unit} = splitQtyUnit(item.qty)
  return {
    item: item.description,
    hsnCode: item.hsn,
    qty,
    unit,
    rate: splitRate(item.rate),
    gstRate: item.taxRate.replace(/%/g, ''),
  }
}

export function salesInvoiceToRenderContext(data: SalesInvoiceData): Record<string, unknown> {
  return {
    company: data.company,
    companyGstin: data.companyGstin,
    party: data.partyName,
    partyName: data.partyName,
    reverseCharge: data.reverseCharge,
    invoiceNo: data.invoiceNo,
    date: data.date,
    voucherClass: data.voucherClass,
    narration: data.narration,
    billingAddress: data.billingAddress,
    customerGstin: data.customerGstin,
    placeOfSupply: data.placeOfSupply,
    discount: data.discount,
    items: [
      {
        description: data.item,
        hsn: data.hsnCode,
        qty: String(data.qty),
        unit: data.unit,
        rate: String(data.rate),
        taxRate: `${data.gstRate}%`,
        taxable: data.totalValue.toFixed(2),
        total: data.totalValue.toFixed(2),
      },
    ],
    totals: {
      taxable: data.totalValue.toFixed(2),
      tax: `${data.gstRate}%`,
      cgst: data.cgst.toFixed(2),
      sgst: data.sgst.toFixed(2),
      igst: data.igst.toFixed(2),
      taxTotal: data.taxTotal.toFixed(2),
      grandTotal: data.grandTotal.toFixed(2),
      discount: data.discount.toFixed(2),
      showCgstSgst: !data.isInterState && data.cgst > 0,
      showIgst: data.isInterState && data.igst > 0,
      showDiscount: data.discount > 0,
    },
    warnings: data.warnings,
  }
}

export function safeFilenameFromSales(data: SalesInvoiceData): string {
  const party = data.partyName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  return `invoice_${party}_${data.invoiceNo}.pdf`
}

/** Field labels for inquirer prompts */
export const FIELD_PROMPTS: Record<InvoiceFieldKey, {message: string; type?: string}> = {
  'invoice-no': {message: 'Invoice number'},
  date: {message: 'Invoice date (D/M/YYYY)'},
  'party-name': {message: 'Party / customer name'},
  'place-of-supply': {message: 'Place of supply (state name or code)'},
  'hsn-code': {message: 'HSN code'},
  item: {message: 'Item description'},
  qty: {message: 'Quantity'},
  rate: {message: 'Rate per unit'},
  unit: {message: 'Unit (Bag, Nos, etc.)'},
  'gst-rate': {message: 'GST rate (%)'},
  'customer-gstin': {message: 'Customer GSTIN (15 chars)'},
}
