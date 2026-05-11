import path from 'node:path'
import {Command, Flags} from '@oclif/core'
import {renderGenericPdf} from '../../lib/renderer.js'

export default class GenerateGeneric extends Command {
  static override description =
    'Generate a generic PDF document from a title and body text.\n' +
    'Useful for receipts, notes, or any unstructured text you want as a printable PDF.'

  static override examples = [
    `$ <%= config.bin %> generate:generic --title "Receipt" --body "Payment of ₹5000 received." --output receipt.pdf`,
    `$ echo "Some content here" | <%= config.bin %> generate:generic --title "Note" --output note.pdf`,
  ]

  static override flags = {
    title: Flags.string({
      char: 't',
      description: 'Document title shown at the top.',
      default: 'Generated Document',
    }),
    body: Flags.string({
      char: 'b',
      description: 'Main content / body text. Supports newlines (use \\n).',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output PDF file path.',
      default: 'document.pdf',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(GenerateGeneric)

    let body = flags.body ?? ''

    // Read from stdin if body not provided and stdin is piped
    if (!body && !process.stdin.isTTY) {
      body = await new Promise<string>((resolve) => {
        let data = ''
        const timer = setTimeout(() => resolve(''), 3000)
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk: string) => { data += chunk })
        process.stdin.on('end', () => { clearTimeout(timer); resolve(data.trim()) })
        process.stdin.on('error', () => { clearTimeout(timer); resolve('') })
      })
    }

    const outputPath = path.resolve(flags.output)
    this.log(`Generating generic PDF → ${outputPath}`)

    await renderGenericPdf(
      {title: flags.title, body, generatedAt: new Date().toLocaleString('en-IN')},
      {outputPath},
    )

    this.log(`Done: ${outputPath}`)
  }
}
