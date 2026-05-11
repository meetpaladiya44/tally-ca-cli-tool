import fs from 'node:fs/promises'
import path from 'node:path'
import {Command, Flags} from '@oclif/core'

import {parseInvoiceText, parseItemFlag, safeFilename, type InvoiceData} from '../../lib/parser.js'
import {renderInvoicePdf} from '../../lib/renderer.js'

export default class GenerateInvoice extends Command {
  static override description =
    'Generate a GST-compliant invoice PDF from raw WhatsApp/Telegram text or explicit flags.\n' +
    'Pass the raw message with --text (or pipe via stdin) and let the parser do the rest.'

  static override examples = [
    // Raw text — agent pipes the WhatsApp message
    `$ echo "Party Name: Rajat Build\\nInvoice No.: 186\\nDate: 2/1/2026\\nItem: PPC Cement @ 18%\\nQty: 140 Bag\\nRate: 279.66/Bag\\nAmount: 39152.40" | <%= config.bin %> generate:invoice --company "Gokul Traders" --output invoice_186.pdf`,

    // Inline --text flag
    `$ <%= config.bin %> generate:invoice --text "Party Name: Rajat Build\\nInvoice No.: 186\\nDate: 2/1/2026\\nItem: PPC Cement @ 18%\\nQty: 140 Bag\\nRate: 279.66/Bag\\nHSN Code: 25322210\\nAmount: 39152.40" --output invoice_186.pdf`,

    // Fully structured flags (when the agent already extracted all fields)
    `$ <%= config.bin %> generate:invoice --company "Gokul Traders" --party "Rajat Build" --invoice-no 186 --date "2/1/2026" --item "PPC Cement|140 Bag|279.66|18%|25322210" --output invoice_186.pdf`,
  ]

  static override flags = {
    // ── Input mode ───────────────────────────────────────────────────────────
    text: Flags.string({
      char: 't',
      description:
        'Raw invoice text (WhatsApp / Telegram message). Mutually exclusive with explicit data flags.',
      exclusive: ['party', 'invoice-no'],
    }),

    // ── Explicit structured flags ─────────────────────────────────────────────
    company: Flags.string({
      char: 'c',
      description: 'Seller / company name printed on the invoice header.',
    }),
    party: Flags.string({
      char: 'p',
      description: 'Buyer / party name.',
    }),
    'invoice-no': Flags.string({
      char: 'n',
      description: 'Invoice number.',
    }),
    date: Flags.string({
      char: 'd',
      description: 'Invoice date (D/M/YYYY or DD-MM-YYYY).',
    }),
    item: Flags.string({
      description:
        'Item in pipe-separated format: "Description|Qty Unit|Rate|Tax%|HSN". Repeatable for multiple items.',
      multiple: true,
    }),
    'voucher-class': Flags.string({
      description: 'TallyPrime voucher class name (e.g. "Sales @ 18 %").',
    }),
    narration: Flags.string({
      description: 'Optional narration / note appended to the invoice.',
    }),

    // ── Output ───────────────────────────────────────────────────────────────
    output: Flags.string({
      char: 'o',
      description: 'Output PDF file path. Defaults to auto-generated name.',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(GenerateInvoice)

    let data: InvoiceData

    // Whether the caller provided enough structured flags to skip text parsing
    const hasStructuredInput = Boolean(
      flags.party ?? flags['invoice-no'] ?? flags.date ?? flags.item?.length,
    )

    if (flags.text) {
      // ── Mode 1: Raw text from --text flag ──────────────────────────────────
      data = parseInvoiceText(flags.text)
      if (flags.company) data.company = flags.company
    } else if (hasStructuredInput) {
      // ── Mode 2: Fully structured flags ─────────────────────────────────────
      data = buildFromFlags(flags)
    } else {
      // ── Mode 3: Read from stdin (piped) ────────────────────────────────────
      const stdinText = await readStdin()
      if (!stdinText) {
        this.error(
          'No input provided. Use --text "...", pipe text via stdin, or pass structured flags (--party, --invoice-no, --item, ...).',
        )
      }
      data = parseInvoiceText(stdinText)
      if (flags.company) data.company = flags.company
    }

    const outputPath = path.resolve(flags.output ?? safeFilename(data))

    this.log(`Generating invoice PDF → ${outputPath}`)
    await renderInvoicePdf(data, {outputPath})
    this.log(`Done: ${outputPath}`)
  }
}

// ─── Build InvoiceData from explicit flags ────────────────────────────────────

function buildFromFlags(flags: Record<string, unknown>): InvoiceData {
  const items = ((flags.item as string[] | undefined) ?? []).map((i) => parseItemFlag(i))
  const taxableSum = items.reduce((sum, it) => {
    const n = parseFloat(String(it.taxable).replace(/,/g, ''))
    return sum + (isNaN(n) ? 0 : n)
  }, 0)

  return {
    company: flags.company as string | undefined,
    party: flags.party as string | undefined,
    invoiceNo: flags['invoice-no'] as string | undefined,
    date: flags.date as string | undefined,
    voucherClass: flags['voucher-class'] as string | undefined,
    narration: flags.narration as string | undefined,
    items,
    totals: {
      taxable: taxableSum > 0 ? taxableSum.toFixed(2) : undefined,
      grandTotal: taxableSum > 0 ? taxableSum.toFixed(2) : undefined,
      tax: items[0]?.taxRate ?? undefined,
    },
  }
}

// ─── Stdin helper (with 3 s timeout to avoid hanging in terminal) ─────────────

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''

  return new Promise((resolve) => {
    let data = ''
    const timer = setTimeout(() => resolve(''), 3000)

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => { data += chunk })
    process.stdin.on('end', () => {
      clearTimeout(timer)
      resolve(data.trim())
    })
    process.stdin.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
  })
}
