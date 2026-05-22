import path from 'node:path'
import {Command, Flags} from '@oclif/core'

import {parseToSalesInput, salesInputFromFlags} from '../../lib/parser.js'
import {runInvoicePdfPipeline} from '../../lib/invoice-pipeline.js'
import {resolveUiOptions} from '../../lib/cli-ui.js'
import type {SalesInvoiceInput} from '../../lib/invoice-schema.js'

export default class GenerateInvoice extends Command {
  static override description =
    'Generate a GST sales invoice PDF with validated fields and auto GST calculation.\n' +
    'Mandatory fields are validated in the CLI; missing fields return structured errors for agents.'

  static override examples = [
    `$ <%= config.bin %> generate:invoice --company "ABC Traders" --party-name "XYZ Build" --invoice-no 186 --date "2/1/2026" --place-of-supply "Uttar Pradesh" --item "PPC Cement" --qty 140 --unit Bag --rate 279.66 --hsn-code 25322210 --gst-rate 18 --output invoice_186.pdf`,
    `$ <%= config.bin %> generate:invoice --text "Party Name: XYZ\\nInvoice No.: 186\\n..." --company "ABC" --output out.pdf --no-interactive --json-errors`,
    `$ <%= config.bin %> generate:invoice --company "ABC" --party "XYZ" --invoice-no 186 --date "2/1/2026" --item "Cement|140 Bag|279.66|18|25322210" --place-of-supply "09" --output inv.pdf`,
  ]

  static override flags = {
    text: Flags.string({
      char: 't',
      description: 'Raw invoice text (WhatsApp / Telegram). Parser extracts fields before validation.',
    }),
    company: Flags.string({char: 'c', description: 'Seller / company name on invoice header.'}),
    'company-gstin': Flags.string({description: 'Seller GSTIN (used for CGST/SGST vs IGST).'}),
    'company-address': Flags.string({description: 'Seller / supplier address.'}),
    'seller-state': Flags.string({description: 'Seller state name or 2-digit code (if no company GSTIN).'}),
    party: Flags.string({char: 'p', description: 'Buyer / party name (alias: --party-name).'}),
    'party-name': Flags.string({description: 'Buyer / party name.'}),
    'invoice-no': Flags.string({char: 'n', description: 'Invoice number (required).'}),
    date: Flags.string({char: 'd', description: 'Invoice date D/M/YYYY (required).'}),
    'place-of-supply': Flags.string({description: 'Place of supply — state name or code (required).'}),
    'customer-gstin': Flags.string({description: 'Customer GSTIN (required when --b2b).'}),
    'hsn-code': Flags.string({description: 'HSN / SAC code (required).'}),
    item: Flags.string({
      description:
        'Item description OR pipe format: Description|Qty Unit|Rate|Tax%|HSN. Repeatable.',
      multiple: true,
    }),
    qty: Flags.string({description: 'Quantity (required if not in --item pipe).'}),
    rate: Flags.string({description: 'Rate per unit (required).'}),
    unit: Flags.string({description: 'Unit e.g. Bag, Nos (required).'}),
    'gst-rate': Flags.string({description: 'GST rate % e.g. 18 (required).'}),
    'billing-address': Flags.string({description: 'Optional billing address.'}),
    'shipping-address': Flags.string({description: 'Optional shipping address.'}),
    discount: Flags.string({description: 'Discount amount (default 0).'}),
    'reverse-charge': Flags.string({description: 'Reverse charge: Yes or No (default No).'}),
    b2b: Flags.boolean({description: 'B2B invoice — requires --customer-gstin.', default: false}),
    'voucher-class': Flags.string({description: 'Optional Tally voucher class label.'}),
    narration: Flags.string({description: 'Optional narration.'}),
    output: Flags.string({char: 'o', description: 'Output PDF path.'}),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Prompt for missing required fields (TTY only).',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Never prompt — for OpenClaw/agents (default when non-TTY).',
      default: false,
    }),
    'json-errors': Flags.boolean({
      description: 'Validation errors as JSON on stderr (for agents).',
      default: false,
    }),
    'no-ui': Flags.boolean({description: 'Disable chalk/spinner/progress (plain logs).', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(GenerateInvoice)
    const ui = resolveUiOptions(flags)

    let input: SalesInvoiceInput

    const itemFlag = flags.item
    const hasItems = Array.isArray(itemFlag) ? itemFlag.length > 0 : Boolean(itemFlag)
    const hasStructured = Boolean(
      flags['invoice-no'] ??
        flags.date ??
        flags['party-name'] ??
        flags.party ??
        hasItems ??
        flags.qty,
    )

    if (flags.text) {
      input = parseToSalesInput(flags.text)
      if (flags.company) input.company = flags.company
      input = mergeFlagOverrides(input, flags)
    } else if (hasStructured) {
      input = salesInputFromFlags(flags as Record<string, unknown>)
    } else {
      const stdinText = await readStdin()
      if (!stdinText) {
        if (ui.jsonErrors) {
          console.error(
            JSON.stringify({
              error: 'validation',
              message: 'No input provided',
              missing: ['invoice-no', 'date', 'party-name', 'place-of-supply', 'item', 'qty', 'rate', 'unit', 'gst-rate', 'hsn-code'],
              warnings: [],
            }),
          )
          process.exit(2)
        }
        this.error(
          'No input provided. Use --text, pipe stdin, or pass structured flags (--invoice-no, --party-name, --item, ...).',
        )
      }
      input = parseToSalesInput(stdinText)
      if (flags.company) input.company = flags.company
      input = mergeFlagOverrides(input, flags)
    }

    await runInvoicePdfPipeline({input, output: flags.output, ui})
  }
}

/**
 * Merge flag values into text-parsed input.
 * Fill-missing-only for text-parsed fields (qty, unit, rate, item, etc.)
 * Always apply operational flags (company, companyGstin, b2b, sellerState)
 */
function mergeFlagOverrides(
  base: SalesInvoiceInput,
  flags: Record<string, unknown>,
): SalesInvoiceInput {
  const o = salesInputFromFlags(flags as Record<string, unknown>)

  // Operational flags always override (not parsed from text or always apply)
  const alwaysApply: (keyof SalesInvoiceInput)[] = [
    'company',
    'companyGstin',
    'companyAddress',
    'sellerState',
    'b2b',
  ]

  // Text-parsed fields: only fill if base is missing/empty
  const fillMissingOnly: (keyof SalesInvoiceInput)[] = [
    'invoiceNo',
    'date',
    'partyName',
    'placeOfSupply',
    'customerGstin',
    'hsnCode',
    'item',
    'qty',
    'rate',
    'unit',
    'gstRate',
    'billingAddress',
    'shippingAddress',
    'discount',
    'reverseCharge',
    'voucherClass',
    'narration',
  ]

  const result: SalesInvoiceInput = {...base}

  // Apply operational flags (always)
  for (const key of alwaysApply) {
    const val = o[key]
    if (val !== undefined && val !== '' && val !== false) {
      ;(result as Record<string, unknown>)[key] = val
    }
  }

  // Fill missing text-parsed fields only
  for (const key of fillMissingOnly) {
    const baseVal = base[key]
    const flagVal = o[key]
    const baseEmpty = baseVal === undefined || baseVal === '' || baseVal === null
    if (baseEmpty && flagVal !== undefined && flagVal !== '' && flagVal !== false) {
      ;(result as Record<string, unknown>)[key] = flagVal
    }
  }

  return result
}

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
