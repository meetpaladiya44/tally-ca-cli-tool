/**
 * Parses raw WhatsApp / Telegram invoice text into structures for validation.
 */

import type {SalesInvoiceInput} from './invoice-schema.js'
import {splitQtyUnit, splitRate, normalizeGstRate} from './validation.js'
import {inputFromLegacyItem} from './invoice-schema.js'

export interface InvoiceItem {
  description: string
  hsn?: string
  qty: string
  unit?: string
  rate: string
  taxRate: string
  taxable: string
  total: string
}

/** @deprecated Legacy shape — use SalesInvoiceInput + validateAndCompute */
export interface InvoiceData {
  company?: string
  party?: string
  invoiceNo?: string
  date?: string
  voucherClass?: string
  items: InvoiceItem[]
  totals: {
    taxable?: string
    tax?: string
    grandTotal?: string
  }
  narration?: string
}

export interface GenericData {
  title: string
  body: string
  generatedAt: string
}

function clean(s: string | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ')
}

function extractField(text: string, ...patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (m?.[1]) return clean(m[1])
  }
  return undefined
}

/** Extract ALL matches for a field and return the last one (useful for Party Name where first may be company) */
function extractLastField(text: string, ...patterns: RegExp[]): string | undefined {
  let last: string | undefined
  for (const pattern of patterns) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let m
    while ((m = globalPattern.exec(text)) !== null) {
      if (m[1]) last = clean(m[1])
    }
  }
  return last
}

function normaliseDate(raw: string): string {
  const parts = raw.split(/[\/\-]/)
  if (parts.length === 3) {
    const [d, m, y] = parts
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.length === 2 ? `20${y}` : y}`
  }
  return raw
}

export function parseItemFlag(flag: string): InvoiceItem {
  const parts = flag.split('|').map((p) => p.trim())
  const [description = '', qtyCombined = '', rate = '', taxRate = '', hsn = ''] = parts
  const taxable = computeTaxable(qtyCombined, rate)
  return {
    description,
    hsn: hsn || undefined,
    qty: qtyCombined,
    rate,
    taxRate: taxRate.replace('%', '') + '%',
    taxable,
    total: taxable,
  }
}

function computeTaxable(qty: string, rate: string): string {
  const q = parseFloat(qty.replace(/[^\d.]/g, ''))
  const r = parseFloat(rate.replace(/[^\d.]/g, ''))
  if (isNaN(q) || isNaN(r)) return ''
  return (q * r).toFixed(2)
}

export function parseInvoiceText(text: string): InvoiceData {
  const input = parseToSalesInput(text)
  const data: InvoiceData = {items: [], totals: {}}
  data.company = input.company
  data.party = input.partyName
  data.invoiceNo = input.invoiceNo
  data.date = input.date
  data.voucherClass = input.voucherClass
  data.narration = input.narration

  if (input.item) {
    data.items.push({
      description: input.item,
      hsn: input.hsnCode,
      qty: `${input.qty ?? ''} ${input.unit ?? ''}`.trim(),
      rate: input.rate ?? '',
      taxRate: input.gstRate ? `${input.gstRate}%` : '',
      taxable: String(input.discount ?? ''),
      total: String(input.discount ?? ''),
    })
  }

  return data
}

/** Parse free text → partial SalesInvoiceInput for schema validation */
export function parseToSalesInput(text: string): SalesInvoiceInput {
  const company =
    extractField(
      text,
      /(?:in|for|company\s*[:–-])\s+([A-Z][A-Za-z0-9 &.,'()-]+?)(?:\s*\.|,|\n|$)/i,
      /company\s*[:–-]\s*(.+?)(?:\n|$)/i,
    ) ?? undefined

  // Use extractLastField to get the LAST Party Name match (first may be company/seller reference)
  const partyName =
    extractLastField(
      text,
      /party\s*(?:name)?\s*[:–-]\s*(.+?)(?:\n|$)/i,
    ) ??
    extractField(text, /customer\s*[:–-]\s*(.+?)(?:\n|$)/i) ??
    undefined

  const invoiceNo =
    extractField(
      text,
      /invoice\s*(?:no|number|#)\.?\s*[:–-]\s*(\w+)/i,
      /inv\.?\s*(?:no)?\.?\s*[:–-]\s*(\w+)/i,
    ) ?? undefined

  const rawDate = extractField(text, /date\s*[:–-]\s*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i)
  const date = rawDate ? normaliseDate(rawDate) : undefined

  const placeOfSupply =
    extractField(
      text,
      /place\s*of\s*supply\s*[:–-]\s*(.+?)(?:\n|$)/i,
      /pos\s*[:–-]\s*(.+?)(?:\n|$)/i,
    ) ?? undefined

  // Customer GSTIN - explicit customer/party/buyer label only (no generic gstin fallback)
  const customerGstin =
    extractField(
      text,
      /(?:customer|party|buyer)\s*gstin\s*[:–-]\s*([0-9A-Z]{15})/i,
    ) ?? undefined

  // Company/Supplier GSTIN - includes "Supplier GSTIN" pattern
  const companyGstin =
    extractField(
      text,
      /(?:supplier|company|seller)\s*gstin\s*[:–-]\s*([0-9A-Z]{15})/i,
    ) ?? undefined

  // Billing address
  const billingAddress =
    extractField(text, /billing\s*address\s*[:–-]\s*(.+?)(?:\n\n|\n(?=[A-Z])|$)/i) ??
    undefined

  // Shipping address
  const shippingAddress =
    extractField(text, /shipping\s*address\s*[:–-]\s*(.+?)(?:\n\n|\n(?=[A-Z])|$)/i) ??
    undefined

  // Company/Supplier address
  const companyAddress =
    extractField(text, /(?:supplier|company|seller)\s*address\s*[:–-]\s*(.+?)(?:\n\n|\n(?=[A-Z])|$)/i) ??
    undefined

  const discountStr = extractField(text, /discount\s*[:–-]\s*[₹]?\s*([\d.,]+)/i)
  const reverseCharge =
    extractField(text, /reverse\s*charge\s*[:–-]\s*(yes|no)/i) ?? undefined

  const voucherClass =
    extractField(text, /voucher\s+class\s+([A-Za-z0-9 @%]+?)(?:\s*\.|,|\n|$)/i) ?? undefined

  const narration = extractField(text, /narration\s*[:–-]\s*(.+?)(?:\n|$)/i) ?? undefined

  const itemLine = extractItemFromText(text)
  const base: SalesInvoiceInput = {
    company,
    companyGstin,
    companyAddress,
    invoiceNo,
    date,
    partyName,
    placeOfSupply,
    customerGstin,
    billingAddress,
    shippingAddress,
    discount: discountStr,
    reverseCharge,
    voucherClass,
    narration,
    b2b: Boolean(customerGstin),
  }

  if (itemLine) {
    const merged = inputFromLegacyItem(itemLine)
    return {...base, ...merged}
  }

  return base
}

function extractItemFromText(text: string): InvoiceItem | null {
  const itemMatch = /item\s*[:–-]\s*(.+?)(?:\n|$)/i.exec(text)
  if (!itemMatch) return null

  let description = clean(itemMatch[1])
  let taxRate = ''
  const atMatch = /(.+?)\s*@\s*([\d.]+)\s*%/.exec(description)
  if (atMatch) {
    description = clean(atMatch[1])
    taxRate = atMatch[2] + '%'
  }

  // Extract qty with robust pattern: "Qty : 140 Bag" or "Qty: 140"
  // Capture full quantity including unit if present (number followed by optional word starting with letter)
  const qtyRaw =
    extractField(text, /qty\s*[:–-]\s*(\d+(?:\.\d+)?(?:\s+[A-Za-z][A-Za-z0-9]*)?)/i) ??
    extractField(text, /quantity\s*[:–-]\s*(\d+(?:\.\d+)?(?:\s+[A-Za-z][A-Za-z0-9]*)?)/i) ??
    ''

  const rate =
    extractField(text, /rate\s*[:–-]\s*[₹]?\s*([\d.,]+\/?\w*)/i) ?? ''

  const hsn = extractField(text, /hsn\s*(?:code)?\s*[:–-]\s*(\d+)/i) ?? undefined

  const amount =
    extractField(text, /amount\s*[:–-]\s*[₹]?\s*([\d,]+\.?\d*)/i) ?? ''

  if (!taxRate) {
    taxRate =
      extractField(text, /@\s*([\d.]+)\s*%/) ??
      extractField(text, /(?:gst|tax)\s*(?:rate)?\s*[:@]\s*([\d.]+)\s*%/i) ??
      ''
    if (taxRate && !taxRate.endsWith('%')) taxRate += '%'
  }

  // First split qty to get qty and unit from the qty line itself
  let qty = qtyRaw
  let unit = ''
  if (qtyRaw) {
    const split = splitQtyUnit(qtyRaw)
    qty = split.qty
    unit = split.unit
  }

  // Only use standalone "Unit:" line as fallback if qty line didn't have a valid unit
  // And only if the unit value looks like an actual unit (starts with letter, not a number)
  if (!unit || unit === 'Nos') {
    const unitOnly = extractField(text, /\bunit\s*[:–-]\s*([A-Za-z][A-Za-z0-9]*)/i)
    if (unitOnly) {
      unit = unitOnly
    }
  }

  return {
    description,
    hsn,
    qty,
    unit,
    rate: splitRate(rate),
    taxRate,
    taxable: amount,
    total: amount,
  }
}

export type DocType = 'invoice' | 'generic'

export function detectDocType(text: string): DocType {
  const lower = text.toLowerCase()
  const invoiceSignals = [
    'invoice',
    'party name',
    'invoice no',
    'hsn',
    'gst',
    'voucher',
    'taxable',
    'sales voucher',
    'purchase',
    'bill',
    'place of supply',
  ]
  const hits = invoiceSignals.filter((s) => lower.includes(s))
  return hits.length >= 2 ? 'invoice' : 'generic'
}

export function safeFilename(data: InvoiceData): string {
  const party = (data.party ?? 'invoice').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  const no = data.invoiceNo ?? 'unknown'
  return `invoice_${party}_${no}.pdf`
}

/** Build SalesInvoiceInput from OCLIF flags */
export function salesInputFromFlags(flags: Record<string, unknown>): SalesInvoiceInput {
  const rawItem = flags.item
  const items = Array.isArray(rawItem)
    ? rawItem
    : rawItem
      ? [String(rawItem)]
      : []
  let merged: SalesInvoiceInput = {
    company: flags.company as string | undefined,
    companyGstin: flags['company-gstin'] as string | undefined,
    companyAddress: flags['company-address'] as string | undefined,
    sellerState: flags['seller-state'] as string | undefined,
    invoiceNo: (flags['invoice-no'] as string | undefined) ?? undefined,
    date: flags.date as string | undefined,
    partyName:
      (flags['party-name'] as string | undefined) ??
      (flags.party as string | undefined),
    placeOfSupply: flags['place-of-supply'] as string | undefined,
    customerGstin: flags['customer-gstin'] as string | undefined,
    billingAddress: flags['billing-address'] as string | undefined,
    shippingAddress: flags['shipping-address'] as string | undefined,
    discount: flags.discount as string | number | undefined,
    reverseCharge: flags['reverse-charge'] as string | undefined,
    b2b: Boolean(flags.b2b),
    voucherClass: flags['voucher-class'] as string | undefined,
    narration: flags.narration as string | undefined,
    hsnCode: flags['hsn-code'] as string | undefined,
    item: flags.item as string | undefined,
    qty: flags.qty as string | undefined,
    rate: flags.rate as string | undefined,
    unit: flags.unit as string | undefined,
    gstRate: flags['gst-rate'] as string | undefined,
  }

  if (items.length > 0 && items[0].includes('|')) {
    const legacy = parseItemFlag(items[0])
    merged = {...merged, ...inputFromLegacyItem(legacy)}
  } else if (items.length > 0) {
    merged.item = items[0]
  }

  if (merged.gstRate) {
    merged.gstRate = normalizeGstRate(String(merged.gstRate))
  }

  return merged
}
