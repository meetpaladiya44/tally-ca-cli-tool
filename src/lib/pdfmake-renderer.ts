/**
 * Fallback PDF generation without Chromium / Playwright.
 * Uses pdfmake (pure JS → PDFKit) so AWS/Linux hosts missing libatk etc. still get consistent invoices.
 */

import {createWriteStream} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import type {Content, StyleDictionary, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces'
import type {GenericData} from './parser.js'

const require = createRequire(import.meta.url)

// pdfmake ships vfs_fonts as CommonJS — module.exports is the vfs map (filename → base64)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake') as new (fonts: PdfPrinterFonts) => PdfPrinterInstance

type PdfPrinterFonts = Record<
  string,
  {
    normal: Buffer
    bold: Buffer
    italics: Buffer
    bolditalics: Buffer
  }
>

interface PdfPrinterInstance {
  createPdfKitDocument(docDefinition: TDocumentDefinitions): NodeJS.ReadableStream & {end: () => void}
}

function robotoFonts(): PdfPrinterFonts {
  const b64 = (key: string) => Buffer.from(vfs[key], 'base64')
  return {
    Roboto: {
      normal: b64('Roboto-Regular.ttf'),
      bold: b64('Roboto-Medium.ttf'),
      italics: b64('Roboto-Italic.ttf'),
      bolditalics: b64('Roboto-MediumItalic.ttf'),
    },
  }
}

let printerSingleton: PdfPrinterInstance | undefined

function getPrinter(): PdfPrinterInstance {
  if (!printerSingleton) {
    printerSingleton = new PdfPrinter(robotoFonts())
  }

  return printerSingleton
}

/** Match Handlebars `inr` helper — Indian grouping, 2 decimals */
export function formatInr(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—'
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''))
  if (Number.isNaN(num)) return String(value)
  return new Intl.NumberFormat('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(num)
}

export async function renderInvoicePdfMake(
  data: Record<string, unknown>,
  outputPath: string,
): Promise<void> {
  await mkdir(path.dirname(path.resolve(outputPath)), {recursive: true})
  const doc = buildInvoiceDoc(data)
  await writePdfToFile(doc, outputPath)
}

export async function renderGenericPdfMake(data: GenericData, outputPath: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(outputPath)), {recursive: true})
  const doc = buildGenericDoc(data)
  await writePdfToFile(doc, outputPath)
}

function buildInvoiceDoc(data: Record<string, unknown>): TDocumentDefinitions {
  const company = data.company as string | undefined
  const party = (data.party ?? data.partyName) as string | undefined
  const invoiceNo = data.invoiceNo as string | undefined
  const date = data.date as string | undefined
  const voucherClass = data.voucherClass as string | undefined
  const narration = data.narration as string | undefined
  const billingAddress = data.billingAddress as string | undefined
  const customerGstin = data.customerGstin as string | undefined
  const placeOfSupply = data.placeOfSupply as string | undefined
  const reverseCharge = data.reverseCharge as string | undefined
  const items = (data.items as Array<Record<string, string>>) ?? []
  const totals = (data.totals as Record<string, unknown>) ?? {}
  const generatedAt = new Date().toLocaleString('en-IN')
  const styles: StyleDictionary = {
    company: {fontSize: 18, bold: true, color: '#1a237e'},
    taxLabel: {
      fontSize: 11,
      bold: true,
      color: '#1a237e',
      alignment: 'right',
      margin: [6, 4, 6, 4],
    },
    voucherPill: {
      fontSize: 8,
      bold: true,
      color: '#3949ab',
      alignment: 'right',
      margin: [0, 4, 0, 0],
    },
    boxTitle: {fontSize: 8, bold: true, color: '#5c6bc0'},
    metaKey: {fontSize: 9, color: '#666666'},
    metaVal: {fontSize: 9, bold: true},
    th: {bold: true, color: '#ffffff', fontSize: 9},
    td: {fontSize: 9},
    narration: {fontSize: 9, color: '#555555'},
    footer: {fontSize: 8, color: '#999999'},
    grandRow: {bold: true, color: '#ffffff', fontSize: 11},
  }

  const headerRightStack: Content[] = [
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: 'TAX INVOICE',
              style: 'taxLabel',
              border: [true, true, true, true],
              borderColor: ['#1a237e', '#1a237e', '#1a237e', '#1a237e'],
            },
          ],
        ],
      },
      layout: defaultTableLayout(),
    },
  ]
  if (voucherClass) {
    headerRightStack.push({text: voucherClass, style: 'voucherPill'})
  }

  const billToStack: Content[] = [
    {text: 'BILL TO', style: 'boxTitle', margin: [0, 0, 0, 4]},
    {
      columns: [
        {width: 'auto', text: 'Party', style: 'metaKey'},
        {width: '*', text: party ?? '—', style: 'metaVal', alignment: 'right'},
      ],
    },
  ]
  if (billingAddress) {
    billToStack.push({
      text: billingAddress,
      fontSize: 8,
      color: '#555555',
      margin: [0, 4, 0, 0],
    })
  }
  if (customerGstin) {
    billToStack.push({
      columns: [
        {width: 'auto', text: 'GSTIN', style: 'metaKey'},
        {width: '*', text: customerGstin, style: 'metaVal', alignment: 'right'},
      ],
    })
  }

  const invDetailsStack: Content[] = [
    {text: 'INVOICE DETAILS', style: 'boxTitle', margin: [0, 0, 0, 4]},
  ]
  if (invoiceNo) {
    invDetailsStack.push({
      columns: [
        {width: 'auto', text: 'Invoice No.', style: 'metaKey'},
        {width: '*', text: invoiceNo, style: 'metaVal', alignment: 'right'},
      ],
      margin: [0, 0, 0, 2],
    })
  }

  if (date) {
    invDetailsStack.push({
      columns: [
        {width: 'auto', text: 'Date', style: 'metaKey'},
        {width: '*', text: date, style: 'metaVal', alignment: 'right'},
      ],
      margin: [0, 0, 0, 2],
    })
  }
  if (placeOfSupply) {
    invDetailsStack.push({
      columns: [
        {width: 'auto', text: 'Place of Supply', style: 'metaKey'},
        {width: '*', text: placeOfSupply, style: 'metaVal', alignment: 'right'},
      ],
      margin: [0, 0, 0, 2],
    })
  }
  invDetailsStack.push({
    columns: [
      {width: 'auto', text: 'Reverse Charge', style: 'metaKey'},
      {width: '*', text: reverseCharge ?? 'No', style: 'metaVal', alignment: 'right'},
    ],
  })

  const content: Content[] = [
    {
      columns: [
        {width: '*', text: company ?? '—', style: 'company'},
        {width: 'auto', stack: headerRightStack},
      ],
      margin: [0, 0, 0, 8],
    },
    {
      canvas: [{type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#1a237e'}],
      margin: [0, 0, 0, 10],
    },
    {
      columns: [
        {
          width: '*',
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: billToStack,
                  fillColor: '#f7f8fd',
                  margin: [8, 8, 8, 8],
                },
              ],
            ],
          },
          layout: boxLayout(),
        },
        {
          width: '*',
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: invDetailsStack,
                  fillColor: '#f7f8fd',
                  margin: [8, 8, 8, 8],
                },
              ],
            ],
          },
          layout: boxLayout(),
        },
      ],
      columnGap: 10,
    },
  ]

  if (narration) {
    content.push({
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [{text: [{text: 'Narration: ', bold: true}, {text: narration}]}],
              fillColor: '#f7f8fd',
              margin: [6, 6, 6, 6],
              border: [true, true, true, true],
              borderColor: ['#c5cae9', '#c5cae9', '#c5cae9', '#c5cae9'],
            },
          ],
        ],
      },
      layout: defaultTableLayout(),
      margin: [0, 10, 0, 10],
    })
  }

  content.push({text: '', margin: [0, 6, 0, 0]})
  content.push(itemsTable(items))
  content.push({text: '', margin: [0, 8, 0, 0]})
  content.push(totalsBlock(totals))
  content.push({text: '', margin: [0, 24, 0, 0]})
  content.push({
    columns: [
      {width: '*', text: ''},
      {
        width: 140,
        stack: [
          {canvas: [{type: 'line', x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 1, lineColor: '#aaaaaa'}]},
          {text: 'Authorised Signatory', fontSize: 9, color: '#555555', margin: [0, 4, 0, 0], alignment: 'right'},
          {
            text: company ?? '',
            fontSize: 8,
            color: '#999999',
            margin: [0, 2, 0, 0],
            alignment: 'right',
          },
        ],
      },
    ],
  })
  content.push({
    columns: [
      {width: '*', text: 'This is a computer-generated invoice.', style: 'footer'},
      {width: 'auto', text: `Generated: ${generatedAt}`, style: 'footer', alignment: 'right'},
    ],
    margin: [0, 16, 0, 0],
  })

  return {
    defaultStyle: {font: 'Roboto', fontSize: 10},
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content,
    styles,
  }
}

function defaultTableLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#dde1f0',
    vLineColor: () => '#dde1f0',
  }
}

function boxLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#dde1f0',
    vLineColor: () => '#dde1f0',
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
  }
}

function itemsTable(items: Array<Record<string, string>>): Content {
  const headerRow: TableCell[] = [
    {text: '#', style: 'th', fillColor: '#1a237e'},
    {text: 'Description', style: 'th', fillColor: '#1a237e'},
    {text: 'HSN', style: 'th', fillColor: '#1a237e'},
    {text: 'Qty', style: 'th', alignment: 'right', fillColor: '#1a237e'},
    {text: 'Unit', style: 'th', alignment: 'right', fillColor: '#1a237e'},
    {text: 'Rate', style: 'th', alignment: 'right', fillColor: '#1a237e'},
    {text: 'Tax %', style: 'th', alignment: 'right', fillColor: '#1a237e'},
    {text: 'Amount', style: 'th', alignment: 'right', fillColor: '#1a237e'},
  ]

  const body: TableCell[][] = [headerRow]

  if (items.length === 0) {
    body.push([
      {
        text: 'No items',
        colSpan: 8,
        alignment: 'center',
        color: '#aaaaaa',
        margin: [0, 12, 0, 12],
      },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ])
  } else {
    items.forEach((it, idx) => {
      const fill = idx % 2 === 0 ? '#f7f8fd' : '#ffffff'
      body.push([
        {text: String(idx + 1), style: 'td', fillColor: fill},
        {text: it.description ?? '', style: 'td', fillColor: fill},
        {text: it.hsn ?? '—', style: 'td', fillColor: fill},
        {text: it.qty ?? '', style: 'td', alignment: 'right', fillColor: fill},
        {text: it.unit ?? '', style: 'td', alignment: 'right', fillColor: fill},
        {text: it.rate ?? '', style: 'td', alignment: 'right', fillColor: fill},
        {text: it.taxRate ?? '', style: 'td', alignment: 'right', fillColor: fill},
        {text: formatInr(it.taxable), style: 'td', alignment: 'right', fillColor: fill},
      ])
    })
  }

  return {
    table: {
      headerRows: 1,
      widths: [20, '*', 48, 36, 36, 48, 32, 58],
      dontBreakRows: true,
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#e8eaf6',
      vLineColor: () => '#e8eaf6',
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  }
}

function totalsBlock(totals: Record<string, unknown>): Content {
  const inner: Content[] = []

  if (totals.taxable) {
    inner.push({
      columns: [
        {width: '*', text: 'Taxable Amount', fontSize: 9},
        {width: 'auto', text: `Rs ${formatInr(String(totals.taxable))}`, fontSize: 9, alignment: 'right'},
      ],
      margin: [8, 6, 8, 4],
    })
  }

  if (totals.showDiscount) {
    inner.push({
      columns: [
        {width: '*', text: 'Discount', fontSize: 9},
        {width: 'auto', text: `Rs ${formatInr(String(totals.discount))}`, fontSize: 9, alignment: 'right'},
      ],
      margin: [8, 0, 8, 4],
    })
  }

  if (totals.showCgstSgst) {
    inner.push({
      columns: [
        {width: '*', text: 'CGST', fontSize: 9},
        {width: 'auto', text: `Rs ${formatInr(String(totals.cgst))}`, fontSize: 9, alignment: 'right'},
      ],
      margin: [8, 0, 8, 2],
    })
    inner.push({
      columns: [
        {width: '*', text: 'SGST', fontSize: 9},
        {width: 'auto', text: `Rs ${formatInr(String(totals.sgst))}`, fontSize: 9, alignment: 'right'},
      ],
      margin: [8, 0, 8, 4],
    })
  }

  if (totals.showIgst) {
    inner.push({
      columns: [
        {width: '*', text: 'IGST', fontSize: 9},
        {width: 'auto', text: `Rs ${formatInr(String(totals.igst))}`, fontSize: 9, alignment: 'right'},
      ],
      margin: [8, 0, 8, 4],
    })
  }

  const grand = String(totals.grandTotal ?? totals.taxable ?? '0')

  inner.push({
    table: {
      widths: ['*', 'auto'],
      body: [
        [
          {text: 'Grand Total', style: 'grandRow', fillColor: '#1a237e', margin: [8, 8, 4, 8]},
          {
            text: `Rs ${formatInr(grand)}`,
            style: 'grandRow',
            alignment: 'right',
            fillColor: '#1a237e',
            margin: [8, 8, 8, 8],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  })

  return {
    columns: [
      {width: '*', text: ''},
      {
        width: 260,
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: inner,
                border: [true, true, true, true],
                borderColor: ['#dde1f0', '#dde1f0', '#dde1f0', '#dde1f0'],
              },
            ],
          ],
        },
        layout: defaultTableLayout(),
      },
    ],
  }
}

function buildGenericDoc(data: GenericData): TDocumentDefinitions {
  return {
    defaultStyle: {font: 'Roboto', fontSize: 11},
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content: [
      {text: data.title, fontSize: 18, bold: true, color: '#1a237e', margin: [0, 0, 0, 12]},
      {
        canvas: [{type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#1a237e'}],
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: data.body,
                preserveTrailingSpaces: true,
                fillColor: '#f7f8fd',
                margin: [12, 14, 12, 14],
              },
            ],
          ],
        },
        layout: boxLayout(),
        margin: [0, 0, 0, 24],
      },
      {
        columns: [
          {width: '*', text: 'Generated by tallyca', fontSize: 8, color: '#999999'},
          {width: 'auto', text: data.generatedAt, fontSize: 8, color: '#999999', alignment: 'right'},
        ],
      },
    ],
  }
}

async function writePdfToFile(docDefinition: TDocumentDefinitions, outputPath: string): Promise<void> {
  const printer = getPrinter()
  const pdfDoc = printer.createPdfKitDocument(docDefinition)

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outputPath)
    pdfDoc.pipe(stream)
    pdfDoc.end()
    stream.on('finish', () => resolve())
    stream.on('error', reject)
  })
}
