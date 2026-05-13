import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {renderHtml} from './templates.js'
import {renderGenericPdfMake, renderInvoicePdfMake} from './pdfmake-renderer.js'
import type {InvoiceData, GenericData} from './parser.js'

export interface RenderOptions {
  outputPath: string
}

export type PdfBackend = 'auto' | 'playwright' | 'pdfmake'

function getPdfBackend(): PdfBackend {
  const v = process.env.TALLYCA_PDF_BACKEND?.toLowerCase().trim()
  if (v === 'playwright' || v === 'pdfmake' || v === 'auto') return v
  return 'auto'
}

/** True when Chromium/Playwright failed due to missing OS libs or browser install issues */
export function isLikelyPlaywrightFailure(err: unknown): boolean {
  const msg = String(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err).toLowerCase()
  const signals = [
    'libatk',
    'libnss',
    'libgbm',
    'libxcomposite',
    'libxdamage',
    'libxrandr',
    'libasound',
    'libpango',
    'libcairo',
    'fontconfig',
    'chromium',
    'playwright',
    'browser',
    'executable doesn\'t exist',
    'failed to launch',
    'missing dependencies',
    'target closed',
    'browser closed',
  ]
  return signals.some((s) => msg.includes(s))
}

// ─── Invoice PDF ──────────────────────────────────────────────────────────────

export async function renderInvoicePdf(data: InvoiceData, opts: RenderOptions): Promise<void> {
  const backend = getPdfBackend()

  if (backend === 'pdfmake') {
    await renderInvoicePdfMake(data, opts.outputPath)
    return
  }

  if (backend === 'playwright') {
    await renderInvoicePlaywright(data, opts.outputPath)
    return
  }

  // auto
  try {
    await renderInvoicePlaywright(data, opts.outputPath)
  } catch (err) {
    if (isLikelyPlaywrightFailure(err)) {
      console.warn(
        '[tallyca] Playwright/Chromium PDF failed; falling back to pdfmake (no browser).',
        err instanceof Error ? err.message : err,
      )
      await renderInvoicePdfMake(data, opts.outputPath)
      return
    }

    throw err
  }
}

async function renderInvoicePlaywright(data: InvoiceData, outputPath: string): Promise<void> {
  const html = await renderHtml('invoice', {
    company: data.company,
    party: data.party,
    invoiceNo: data.invoiceNo,
    date: data.date,
    voucherClass: data.voucherClass,
    items: data.items,
    totals: data.totals,
    narration: data.narration,
  })
  await writePdfHtml(html, outputPath)
}

// ─── Generic PDF ──────────────────────────────────────────────────────────────

export async function renderGenericPdf(data: GenericData, opts: RenderOptions): Promise<void> {
  const backend = getPdfBackend()

  if (backend === 'pdfmake') {
    await renderGenericPdfMake(data, opts.outputPath)
    return
  }

  if (backend === 'playwright') {
    await renderGenericPlaywright(data, opts.outputPath)
    return
  }

  try {
    await renderGenericPlaywright(data, opts.outputPath)
  } catch (err) {
    if (isLikelyPlaywrightFailure(err)) {
      console.warn(
        '[tallyca] Playwright/Chromium PDF failed; falling back to pdfmake (no browser).',
        err instanceof Error ? err.message : err,
      )
      await renderGenericPdfMake(data, opts.outputPath)
      return
    }

    throw err
  }
}

async function renderGenericPlaywright(data: GenericData, outputPath: string): Promise<void> {
  const html = await renderHtml('generic', {
    title: data.title,
    body: data.body,
    generatedAt: data.generatedAt,
  })
  await writePdfHtml(html, outputPath)
}

// ─── Core Playwright renderer ─────────────────────────────────────────────────

async function writePdfHtml(html: string, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(outputPath)), {recursive: true})

  const browser = await chromium.launch({headless: true})
  try {
    const page = await browser.newPage()
    await page.setContent(html, {waitUntil: 'networkidle'})
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {top: '14mm', right: '14mm', bottom: '14mm', left: '14mm'},
    })
  } finally {
    await browser.close()
  }
}
