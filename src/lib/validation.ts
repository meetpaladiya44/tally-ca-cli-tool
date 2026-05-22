import validator from 'validator'

export function isNonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

export function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const n = parseFloat(value.replace(/,/g, '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase()
  if (v.length !== 15) return false
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)
}

export function gstinStateCode(gstin: string): string | undefined {
  const v = gstin.trim().toUpperCase()
  if (!isValidGstin(v)) return undefined
  return v.slice(0, 2)
}

export function isValidHsn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 && digits.length <= 8
}

export function isValidDateString(value: string): boolean {
  const parts = value.split(/[\/\-]/)
  if (parts.length !== 3) return false
  const [d, m, y] = parts.map((p) => parseInt(p, 10))
  if (!d || !m || !y) return false
  const year = y < 100 ? 2000 + y : y
  const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return validator.isISO8601(iso, {strict: true})
}

export function normalizeGstRate(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const n = parseFloat(value.replace(/%/g, '').trim())
  if (Number.isNaN(n)) return undefined
  return String(n)
}

/** Split "140 Bag" → { qty: "140", unit: "Bag" } */
export function splitQtyUnit(combined: string): {qty: string; unit: string} {
  const trimmed = combined.trim()
  // Match number followed by whitespace and non-digit unit
  const m = /^([\d.,]+)\s+([A-Za-z]\S*)/.exec(trimmed)
  if (m) return {qty: m[1].trim(), unit: m[2].trim()}
  // Fallback: just extract the number part
  const num = trimmed.match(/^[\d.,]+/)?.[0]
  if (num) return {qty: num, unit: trimmed.slice(num.length).trim() || 'Nos'}
  return {qty: trimmed, unit: 'Nos'}
}

/** Split rate like "279.66/Bag" → { rate: "279.66", unit hint optional } */
export function splitRate(value: string): string {
  const m = /^([\d.,]+)/.exec(value.trim())
  return m ? m[1] : value.trim()
}
