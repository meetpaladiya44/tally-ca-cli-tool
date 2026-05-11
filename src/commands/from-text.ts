import path from 'node:path'
import {Command, Flags} from '@oclif/core'

import {parseInvoiceText, detectDocType, safeFilename} from '../lib/parser.js'
import {renderInvoicePdf, renderGenericPdf} from '../lib/renderer.js'

/**
 * Magic command: accepts any raw text (WhatsApp message, Telegram forward, etc.),
 * auto-detects whether it is an invoice or a generic document, then generates the PDF.
 *
 * This is the single command OpenClaw should call when it does not know the document
 * type in advance. The detector checks for keywords like "invoice", "party name",
 * "HSN", "GST", "voucher" and routes automatically.
 */
export default class FromText extends Command {
  static override description =
    'Auto-detect document type from raw text and generate a PDF.\n' +
    'Supports invoice messages (WhatsApp / Telegram) and generic text documents.\n'

  static override examples = [
    // Pipe raw WhatsApp invoice
    `$ echo "Party Name: Rajat Build\\nInvoice No.: 186\\nDate: 2/1/2026\\nItem: PPC Cement 2523 @ 18%\\nQty: 140 Bag\\nRate: ₹279.66/Bag\\nHSN Code: 25322210\\nAmount: 39152.40\\nMake sure to use voucher class Sales @ 18 %" | <%= config.bin %> from-text --company "Gokul Traders" --output invoice_186.pdf`,

    // Inline --text flag
    `$ <%= config.bin %> from-text --text "Party Name: Rajat Build\\nInvoice No.: 186\\nAmount: 39152.40" --output invoice.pdf`,

    // Generic document
    `$ <%= config.bin %> from-text --text "Payment received from Rajat Build for ₹39152." --title "Receipt" --output receipt.pdf`,
  ]

  static override flags = {
    text: Flags.string({
      char: 't',
      description: 'Raw text to convert to PDF. Reads from stdin if not provided.',
    }),
    company: Flags.string({
      char: 'c',
      description: 'Company / seller name (used for invoice header when detected).',
    }),
    title: Flags.string({
      description: 'Document title override (used for generic documents).',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output PDF path. Auto-generated if omitted.',
    }),
    type: Flags.string({
      description: 'Force document type: "invoice" or "generic". Skip auto-detection.',
      options: ['invoice', 'generic'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(FromText)

    // ── Resolve input text ─────────────────────────────────────────────────────
    let text = flags.text ?? ''

    if (!text && !process.stdin.isTTY) {
      text = await new Promise<string>((resolve) => {
        let buf = ''
        const timer = setTimeout(() => resolve(''), 3000)
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk: string) => { buf += chunk })
        process.stdin.on('end', () => { clearTimeout(timer); resolve(buf.trim()) })
        process.stdin.on('error', () => { clearTimeout(timer); resolve('') })
      })
    }

    if (!text) {
      this.error('No input text provided. Use --text "..." or pipe text via stdin.')
    }

    // ── Detect document type ───────────────────────────────────────────────────
    const docType = (flags.type as 'invoice' | 'generic' | undefined) ?? detectDocType(text)
    this.log(`Detected document type: ${docType}`)

    if (docType === 'invoice') {
      const data = parseInvoiceText(text)
      if (flags.company) data.company = flags.company

      const outputPath = path.resolve(flags.output ?? safeFilename(data))
      this.log(`Generating invoice PDF → ${outputPath}`)
      await renderInvoicePdf(data, {outputPath})
      this.log(`Done: ${outputPath}`)
    } else {
      const title = flags.title ?? 'Document'
      const outputPath = path.resolve(
        flags.output ?? `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pdf`,
      )
      this.log(`Generating generic PDF → ${outputPath}`)
      await renderGenericPdf(
        {title, body: text, generatedAt: new Date().toLocaleString('en-IN')},
        {outputPath},
      )
      this.log(`Done: ${outputPath}`)
    }
  }
}
