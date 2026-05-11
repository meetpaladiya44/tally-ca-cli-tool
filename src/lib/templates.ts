import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import Handlebars from 'handlebars'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Templates live next to the compiled JS in dist/templates, but during
// development they are in src/templates. Resolve both.
const TEMPLATE_DIRS = [
  path.resolve(__dirname, '..', 'templates'),       // dist/templates (production)
  path.resolve(__dirname, '..', '..', 'src', 'templates'), // src/templates (dev)
]

async function findTemplate(name: string): Promise<string> {
  for (const dir of TEMPLATE_DIRS) {
    const p = path.join(dir, name)
    try {
      await fs.access(p)
      return p
    } catch {
      // try next
    }
  }
  throw new Error(`Template "${name}" not found. Searched: ${TEMPLATE_DIRS.join(', ')}`)
}

// ─── Handlebars helpers ───────────────────────────────────────────────────────

Handlebars.registerHelper('or', (a: unknown, b: unknown) => a || b)
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b)
Handlebars.registerHelper('add', (a: number, b: number) => a + b)

/** Format a number string with Indian comma grouping: 39152.40 → 39,152.40 */
Handlebars.registerHelper('inr', (value: string | number) => {
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''))
  if (isNaN(num)) return value
  return new Intl.NumberFormat('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(num)
})

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderHtml(templateName: string, context: Record<string, unknown>): Promise<string> {
  const templatePath = await findTemplate(`${templateName}.html`)
  const source = await fs.readFile(templatePath, 'utf8')
  const template = Handlebars.compile(source, {noEscape: false})
  return template({...context, generatedAt: new Date().toLocaleString('en-IN')})
}
