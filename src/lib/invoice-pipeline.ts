import path from 'node:path'
import {
  type SalesInvoiceInput,
  validateAndCompute,
  salesInvoiceToRenderContext,
  safeFilenameFromSales,
  InvoiceValidationError,
  getMissingFields,
} from './invoice-schema.js'
import {
  createSpinner,
  printHeader,
  printSuccess,
  printValidationError,
  printWarnings,
  promptMissingFields,
  runWithProgress,
  type UiOptions,
} from './cli-ui.js'
import {renderInvoicePdf} from './renderer.js'

export interface RunInvoicePdfOptions {
  input: SalesInvoiceInput
  output?: string
  ui: UiOptions
}

export async function runInvoicePdfPipeline(opts: RunInvoicePdfOptions): Promise<string> {
  const {ui} = opts
  if (ui.enabled) printHeader()

  let input = {...opts.input}

  if (ui.interactive) {
    const missing = getMissingFields(input)
    if (missing.length > 0) {
      input = await promptMissingFields(input, missing)
    }
  }

  let data
  try {
    data = validateAndCompute(input)
  } catch (e) {
    if (e instanceof InvoiceValidationError) {
      printValidationError(e.missing, e.warnings, ui.jsonErrors, e.message)
    }
    throw e
  }

  if (data.warnings.length > 0 && ui.enabled) {
    printWarnings(data.warnings)
  }

  const outputPath = path.resolve(opts.output ?? safeFilenameFromSales(data))
  const context = salesInvoiceToRenderContext(data)

  const buildSpinner = createSpinner('Building invoice…', ui.enabled)
  buildSpinner.succeed('Invoice data ready')

  const renderSpinner = createSpinner('Rendering PDF…', ui.enabled)
  await runWithProgress('Generating PDF', ui.enabled, async () => {
    await renderInvoicePdf(context, {outputPath})
  })
  renderSpinner.succeed('PDF rendered')

  if (ui.enabled) {
    printSuccess(outputPath)
  } else {
    console.log(outputPath)
  }

  return outputPath
}
