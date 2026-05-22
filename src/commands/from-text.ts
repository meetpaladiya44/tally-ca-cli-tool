import path from 'node:path'
import {Command, Flags} from '@oclif/core'

import {parseToSalesInput, detectDocType} from '../lib/parser.js'
import {runInvoicePdfPipeline} from '../lib/invoice-pipeline.js'
import {resolveUiOptions} from '../lib/cli-ui.js'
import {renderGenericPdf} from '../lib/renderer.js'

export default class FromText extends Command {
  static override description =
    'Auto-detect document type from raw text and generate a PDF.\n' +
    'Sales invoices use full field validation and GST auto-calculation.'

  static override examples = [
    `$ <%= config.bin %> from-text --company "ABC Traders" --text "Party Name: XYZ\\nInvoice No.: 186\\n..." --output invoice.pdf --no-interactive --json-errors`,
  ]

  static override flags = {
    text: Flags.string({char: 't', description: 'Raw text. Reads stdin if omitted.'}),
    company: Flags.string({char: 'c', description: 'Seller / company name.'}),
    'company-gstin': Flags.string({description: 'Seller GSTIN.'}),
    'company-address': Flags.string({description: 'Seller / supplier address.'}),
    title: Flags.string({description: 'Title for generic documents.'}),
    output: Flags.string({char: 'o', description: 'Output PDF path.'}),
    type: Flags.string({
      description: 'Force type: invoice | generic',
      options: ['invoice', 'generic'],
    }),
    b2b: Flags.boolean({description: 'Treat as B2B (requires customer GSTIN in text/flags).', default: false}),
    'no-interactive': Flags.boolean({description: 'No prompts (for agents).', default: false}),
    'json-errors': Flags.boolean({description: 'JSON validation errors.', default: false}),
    'no-ui': Flags.boolean({description: 'Plain output.', default: false}),
    interactive: Flags.boolean({char: 'i', description: 'Prompt missing fields on TTY.', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(FromText)
    const ui = resolveUiOptions(flags)

    let text = flags.text ?? ''
    if (!text && !process.stdin.isTTY) {
      text = await new Promise<string>((resolve) => {
        let buf = ''
        const timer = setTimeout(() => resolve(''), 3000)
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (c: string) => { buf += c })
        process.stdin.on('end', () => { clearTimeout(timer); resolve(buf.trim()) })
        process.stdin.on('error', () => { clearTimeout(timer); resolve('') })
      })
    }

    if (!text) {
      this.error('No input text. Use --text or pipe via stdin.')
    }

    const docType = (flags.type as 'invoice' | 'generic' | undefined) ?? detectDocType(text)

    if (!ui.enabled) {
      this.log(`Detected document type: ${docType}`)
    }

    if (docType === 'invoice') {
      const input = parseToSalesInput(text)
      if (flags.company) input.company = flags.company
      if (flags['company-gstin']) input.companyGstin = flags['company-gstin']
      if (flags['company-address']) input.companyAddress = flags['company-address']
      if (flags.b2b) input.b2b = true

      await runInvoicePdfPipeline({input, output: flags.output, ui})
    } else {
      const title = flags.title ?? 'Document'
      const outputPath = path.resolve(
        flags.output ?? `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pdf`,
      )
      await renderGenericPdf(
        {title, body: text, generatedAt: new Date().toLocaleString('en-IN')},
        {outputPath},
      )
      if (ui.enabled) {
        const {printSuccess} = await import('../lib/cli-ui.js')
        printSuccess(outputPath)
      } else {
        this.log(`Done: ${outputPath}`)
      }
    }
  }
}
