/**
 * Parses raw WhatsApp / Telegram invoice text into a typed InvoiceData structure.
 * No LLM required — pure regex extraction tuned for Indian GST invoice messages.
 */

export interface InvoiceItem {
  description: string
  hsn?: string
  qty: string
  rate: string
  taxRate: string
  taxable: string
  total: string
}

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

// ─── Normalisation helpers ────────────────────────────────────────────────────

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

// ─── Date normaliser: various formats → DD-MM-YYYY ───────────────────────────
function normaliseDate(raw: string): string {
  // Already DD-MM-YYYY or D/M/YYYY
  const parts = raw.split(/[\/\-]/)
  if (parts.length === 3) {
    const [d, m, y] = parts
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y.length === 2 ? `20${y}` : y}`
  }
  return raw
}

// ─── Item line parser ─────────────────────────────────────────────────────────
/**
 * Supports pipe-separated structured item:  "PPC Cement|140 Bag|279.66|18%|25322210"
 * as well as free-text extraction from the raw message body.
 */
export function parseItemFlag(flag: string): InvoiceItem {
  const parts = flag.split('|').map((p) => p.trim())
  const [description = '', qty = '', rate = '', taxRate = '', hsn = ''] = parts
  const taxable = computeTaxable(qty, rate)
  return {
    description,
    hsn: hsn || undefined,
    qty,
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

// ─── Free-text (WhatsApp message) invoice parser ──────────────────────────────

export function parseInvoiceText(text: string): InvoiceData {
  const data: InvoiceData = {items: [], totals: {}}

  // Company — "in <Company>" or "for <Company>" or explicit label
  data.company =
    extractField(
      text,
      /(?:in|for|company\s*[:–-])\s+([A-Z][A-Za-z0-9 &.,'()-]+?)(?:\s*\.|,|\n|$)/i,
      /company\s*[:–-]\s*(.+?)(?:\n|$)/i,
    ) ?? undefined

  // Party
  data.party =
    extractField(
      text,
      /party\s*(?:name)?\s*[:–-]\s*(.+?)(?:\n|$)/i,
      /customer\s*[:–-]\s*(.+?)(?:\n|$)/i,
    ) ?? undefined

  // Invoice number
  data.invoiceNo =
    extractField(
      text,
      /invoice\s*(?:no|number|#)\.?\s*[:–-]\s*(\w+)/i,
      /inv\.?\s*(?:no)?\.?\s*[:–-]\s*(\w+)/i,
    ) ?? undefined

  // Date
  const rawDate = extractField(text, /date\s*[:–-]\s*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i)
  data.date = rawDate ? normaliseDate(rawDate) : undefined

  // Voucher class — "voucher class <Name>" or "use voucher class <Name>"
  data.voucherClass =
    extractField(
      text,
      /voucher\s+class\s+([A-Za-z0-9 @%]+?)(?:\s*\.|,|\n|$)/i,
    ) ?? undefined

  // Narration
  data.narration =
    extractField(text, /narration\s*[:–-]\s*(.+?)(?:\n|$)/i) ?? undefined

  // ── Item extraction ────────────────────────────────────────────────────────
  const item = extractItemFromText(text)
  if (item) data.items.push(item)

  // ── Totals ─────────────────────────────────────────────────────────────────
  const amount = extractField(
    text,
    /amount\s*[:–-]\s*[₹]?\s*([\d,]+\.?\d*)/i,
    /total\s*[:–-]\s*[₹]?\s*([\d,]+\.?\d*)/i,
  )
  if (amount) {
    data.totals.taxable = amount
    data.totals.grandTotal = amount
  }

  const taxRate =
    extractField(text, /@\s*([\d.]+)\s*%/) ??
    extractField(text, /(?:gst|tax)\s*(?:rate)?\s*[:@]\s*([\d.]+)\s*%/i)
  if (taxRate) {
    data.totals.tax = taxRate + '%'
    // Backfill into item if it had no tax rate
    if (data.items[0] && !data.items[0].taxRate) {
      data.items[0].taxRate = taxRate + '%'
    }
  }

  return data
}

function extractItemFromText(text: string): InvoiceItem | null {
  // "Item: PPC Cement 2523 @ 18 %" or "Item: PPC Cement @ 18%"
  const itemMatch = /item\s*[:–-]\s*(.+?)(?:\n|$)/i.exec(text)
  if (!itemMatch) return null

  // Separate description from inline tax "@ X%"
  let description = clean(itemMatch[1])
  let taxRate = ''
  const atMatch = /(.+?)\s*@\s*([\d.]+)\s*%/.exec(description)
  if (atMatch) {
    description = clean(atMatch[1])
    taxRate = atMatch[2] + '%'
  }

  const qty =
    extractField(text, /qty\s*[:–-]\s*([\d.]+\s*\w+)/i) ??
    extractField(text, /quantity\s*[:–-]\s*([\d.]+\s*\w+)/i) ??
    ''

  const rate =
    extractField(text, /rate\s*[:–-]\s*[₹]?\s*([\d.,]+\/?\w*)/i) ?? ''

  const hsn =
    extractField(text, /hsn\s*(?:code)?\s*[:–-]\s*(\d+)/i) ?? undefined

  const amount =
    extractField(text, /amount\s*[:–-]\s*[₹]?\s*([\d,]+\.?\d*)/i) ?? ''

  if (!taxRate) {
    taxRate =
      extractField(text, /@\s*([\d.]+)\s*%/) ??
      extractField(text, /(?:gst|tax)\s*(?:rate)?\s*[:@]\s*([\d.]+)\s*%/i) ??
      ''
    if (taxRate && !taxRate.endsWith('%')) taxRate += '%'
  }

  return {
    description,
    hsn,
    qty,
    rate,
    taxRate,
    taxable: amount,
    total: amount,
  }
}

// ─── Auto-detect document type from raw text ─────────────────────────────────

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
  ]
  const hits = invoiceSignals.filter((s) => lower.includes(s))
  return hits.length >= 2 ? 'invoice' : 'generic'
}

// ─── Safe output filename ─────────────────────────────────────────────────────

export function safeFilename(data: InvoiceData): string {
  const party = (data.party ?? 'invoice').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  const no = data.invoiceNo ?? 'unknown'
  return `invoice_${party}_${no}.pdf`
}
