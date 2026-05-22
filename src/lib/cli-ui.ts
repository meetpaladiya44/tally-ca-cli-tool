import chalk from 'chalk'
import ora from 'ora'
import ProgressBar from 'progress'
import inquirer from 'inquirer'
import type {InvoiceFieldKey, SalesInvoiceInput} from './invoice-schema.js'
import {FIELD_PROMPTS} from './invoice-schema.js'

export interface UiOptions {
  enabled: boolean
  interactive: boolean
  jsonErrors: boolean
}

export function resolveUiOptions(flags: {
  'no-ui'?: boolean
  'no-interactive'?: boolean
  interactive?: boolean
  'json-errors'?: boolean
}): UiOptions {
  const jsonErrors =
    Boolean(flags['json-errors']) || process.env.TALLYCA_JSON_ERRORS === '1'
  const tty = process.stdin.isTTY && process.stdout.isTTY
  const noInteractive = Boolean(flags['no-interactive']) || !tty
  const interactive = Boolean(flags.interactive) && tty && !noInteractive

  return {
    enabled: tty && !flags['no-ui'],
    interactive,
    jsonErrors,
  }
}

export function printHeader(): void {
  console.log(chalk.bold.cyan('\n  TallyCA — Sales Invoice PDF\n'))
}

export function printSuccess(outputPath: string): void {
  console.log(chalk.green(`\n  ✔ PDF saved: ${outputPath}\n`))
}

export function printWarnings(warnings: string[]): void {
  for (const w of warnings) {
    console.log(chalk.yellow(`  ⚠ ${w}`))
  }
}

export function printValidationError(
  missing: InvoiceFieldKey[],
  warnings: string[],
  jsonErrors: boolean,
  message = 'Missing required invoice fields',
): never {
  if (jsonErrors) {
    const payload = {
      error: 'validation' as const,
      message,
      missing,
      warnings,
    }
    console.error(JSON.stringify(payload))
  } else if (missing.length > 0) {
    console.error(chalk.red(`\n  ✖ Missing required fields: ${missing.join(', ')}`))
    console.error(
      chalk.dim(
        `  Required: invoice-no, date, party-name, place-of-supply, hsn-code, item, qty, rate, unit, gst-rate` +
          (missing.includes('customer-gstin') ? ' (+ customer-gstin for B2B)' : ''),
      ),
    )
    for (const w of warnings) {
      console.error(chalk.yellow(`  ⚠ ${w}`))
    }
    console.error('')
  } else {
    console.error(chalk.red(`\n  ✖ ${message}`))
    for (const w of warnings) {
      console.error(chalk.yellow(`  ⚠ ${w}`))
    }
    console.error('')
  }

  process.exit(2)
}

export async function promptMissingFields(
  input: SalesInvoiceInput,
  missing: InvoiceFieldKey[],
): Promise<SalesInvoiceInput> {
  const updated = {...input}

  for (const key of missing) {
    const meta = FIELD_PROMPTS[key]
    const {value} = await inquirer.prompt([
      {
        type: 'input',
        name: 'value',
        message: meta.message,
        validate: (v: string) => (v?.trim() ? true : 'Required'),
      },
    ])

    switch (key) {
      case 'invoice-no':
        updated.invoiceNo = value
        break
      case 'date':
        updated.date = value
        break
      case 'party-name':
        updated.partyName = value
        break
      case 'place-of-supply':
        updated.placeOfSupply = value
        break
      case 'hsn-code':
        updated.hsnCode = value
        break
      case 'item':
        updated.item = value
        break
      case 'qty':
        updated.qty = value
        break
      case 'rate':
        updated.rate = value
        break
      case 'unit':
        updated.unit = value
        break
      case 'gst-rate':
        updated.gstRate = value
        break
      case 'customer-gstin':
        updated.customerGstin = value
        break
    }
  }

  return updated
}

export function createSpinner(text: string, enabled: boolean): ora.Ora {
  if (!enabled) {
    return ora({text, isEnabled: false})
  }

  return ora(text).start()
}

export async function runWithProgress(
  label: string,
  enabled: boolean,
  task: () => Promise<void>,
): Promise<void> {
  if (!enabled) {
    await task()
    return
  }

  const bar = new ProgressBar(`  ${label} [:bar] :percent :etas`, {
    complete: '█',
    incomplete: '░',
    width: 28,
    total: 100,
  })

  let tick = 0
  const timer = setInterval(() => {
    tick = Math.min(95, tick + 8)
    bar.update(tick / 100)
  }, 120)

  try {
    await task()
    bar.update(1)
  } finally {
    clearInterval(timer)
  }
}
