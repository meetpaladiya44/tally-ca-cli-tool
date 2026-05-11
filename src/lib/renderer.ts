import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {renderHtml} from './templates.js'
import type {InvoiceData, GenericData} from './parser.js'

export interface RenderOptions {
  outputPath: string
}

// ─── Invoice PDF ──────────────────────────────────────────────────────────────

export async function renderInvoicePdf(data: InvoiceData, opts: RenderOptions): Promise<void> {
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
  await writePdf(html, opts.outputPath)
}

// ─── Generic PDF ──────────────────────────────────────────────────────────────

export async function renderGenericPdf(data: GenericData, opts: RenderOptions): Promise<void> {
  const html = await renderHtml('generic', {
    title: data.title,
    body: data.body,
    generatedAt: data.generatedAt,
  })
  await writePdf(html, opts.outputPath)
}

// ─── Core Playwright renderer ─────────────────────────────────────────────────

async function writePdf(html: string, outputPath: string): Promise<void> {
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
