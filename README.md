# `tallyca` — WhatsApp text → PDF (CLI)

Generate **GST-style invoice PDFs** (or generic PDFs) directly from raw WhatsApp/Telegram text

## Install

```bash
npm install -g tallyca
```

> Note: By default `tallyca` tries **Playwright + Chromium** first (best match to the HTML templates). If Chromium cannot start (common on minimal Linux/AWS images missing system libraries), it **automatically falls back** to **pdfmake** (pure JavaScript, no browser). You can force the backend — see [PDF backend](#pdf-backend-tallyca_pdf_backend).

### AWS / Linux: Chromium system libraries

If Playwright fails with errors like `libatk-1.0.so.0` or similar, install OS packages for headless Chromium, then reinstall the browser:

**Amazon Linux 2 / AL2023**

```bash
sudo yum install -y \
  alsa-lib atk at-spi2-atk cups-libs libdrm libXcomposite \
  libXdamage libXrandr mesa-libgbm pango gtk3
npx playwright install chromium
npx playwright install-deps chromium
```

**Ubuntu / Debian**

```bash
sudo apt-get update
sudo apt-get install -y \
  libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0
npx playwright install chromium
npx playwright install-deps chromium
```

If you cannot install these packages (e.g. locked-down serverless), rely on the built-in **pdfmake** fallback or set `TALLYCA_PDF_BACKEND=pdfmake`.

### PDF backend (`TALLYCA_PDF_BACKEND`)

| Value | Behavior |
|-------|----------|
| `auto` (default) | Try Playwright first; on typical Chromium launch failures, fall back to pdfmake |
| `playwright` | HTML templates + Playwright only (fails if Chromium unavailable) |
| `pdfmake` | Skip Playwright; generate PDF with pdfmake (no Chromium) |

Example:

```bash
export TALLYCA_PDF_BACKEND=pdfmake
tallyca from-text --company "ABC Traders" --output invoice.pdf --text "Party Name: ..."
```

On Windows PowerShell:

```powershell
$env:TALLYCA_PDF_BACKEND = "pdfmake"
tallyca from-text ...
```

## Sales invoice field schema (v1.1.0+)

The CLI is the **single source of truth**: it validates mandatory fields, computes taxable value and CGST/SGST/IGST, then renders the PDF. Agents should not pre-calculate tax splits.

| Field | Rule | Notes |
|-------|------|-------|
| `invoice-no` | **required** | Hard error if missing |
| `date` | **required** | Normalized to DD-MM-YYYY |
| `party-name` | **required** | Bill-to name (`--party` alias) |
| `place-of-supply` | **required** | State name or 2-digit code |
| `hsn-code` | **required** | Per line item |
| `item` | **required** | Description |
| `qty` | **required** | Numeric |
| `rate` | **required** | Per unit, numeric |
| `unit` | **required** | Bag, Nos, etc. |
| `gst-rate` | **required** | e.g. `18` |
| `customer-gstin` | **conditional** | Required when `--b2b` |
| `billing-address` | optional | Shown if present |
| `discount` | optional | Default `0` |
| `reverse-charge` | optional | Default `No` |
| `total-value` | **auto** | `qty × rate − discount` |
| `cgst` / `sgst` / `igst` | **auto** | Intra-state → CGST+SGST; inter-state → IGST |

**Separate (not in schema):** `company` (seller header), optional `company-gstin`, `seller-state`, `voucher-class`, `narration`.

**GST split:** Seller state from `--company-gstin` (first 2 digits) or `--seller-state`. Buyer state from `customer-gstin` (B2B) or `place-of-supply`. Same state → CGST/SGST; different → IGST. If seller state is unknown, CLI warns and assumes intra-state.

### Agent / automation flags

| Flag | Purpose |
|------|---------|
| `--no-interactive` | Never prompt (required for OpenClaw / pipes) |
| `--json-errors` | Validation errors as JSON on stderr |
| `TALLYCA_JSON_ERRORS=1` | Same as `--json-errors` |

On validation failure the CLI exits with code **2**. Example stderr:

```json
{
  "error": "validation",
  "message": "Missing required invoice fields",
  "missing": ["place-of-supply", "unit"],
  "warnings": ["seller-state not set; assumed intra-state CGST/SGST"]
}
```

Human stderr (default):

```
✖ Missing required fields: place-of-supply, unit
  Required: invoice-no, date, party-name, place-of-supply, hsn-code, item, qty, rate, unit, gst-rate
```

### Interactive mode (TTY)

When stdin is a TTY and `--no-interactive` is not set, use `--interactive` to prompt only for missing **required** fields (not auto-calculated totals or tax). Spinners and progress use chalk/ora unless `--no-ui` is set.

## Commands

### 1) Auto-detect & generate PDF (recommended)

Use this when you want a single “magic” command that decides invoice vs generic automatically:

```bash
tallyca from-text --company "ABC Traders" --output invoice_186.pdf --text "Okay. Now, I want to post invoice data as Sales Voucher in ABC Traders.

Party Name : XYZ Build
Invoice No. : 186
Date : 2/1/2026
Item: Ambuja Cement 2523 @ 18 %
Qty: 140 Bag
Rate: 279.66/Bag
HSN Code : 25322210
Amount : 39152.40

Make sure to use voucher class Sales @ 18 %. Post this as Item Invoice."
```

You can also pipe text:

```bash
echo "Party Name: XYZ Build
Invoice No.: 186
Amount: 39152.40" | tallyca from-text --company "ABC Traders" --output invoice_186.pdf
```

### 2) Generate invoice PDF (raw text OR flags)

#### a) Raw text (parse automatically)

```bash
tallyca generate:invoice --company "ABC Traders" --output invoice_186.pdf --text "Party Name : XYZ Build
Invoice No. : 186
Date : 2/1/2026
Item: Ambuja Cement 2523 @ 18 %
Qty: 140 Bag
Rate: 279.66/Bag
HSN Code : 25322210
Amount : 39152.40
Make sure to use voucher class Sales @ 18 %."
```

#### b) Structured flags (recommended for agents)

```bash
tallyca generate:invoice \
  --company "ABC Traders" \
  --party-name "XYZ Build" \
  --invoice-no 186 \
  --date "2/1/2026" \
  --place-of-supply "Uttar Pradesh" \
  --item "Ambuja Cement" \
  --qty 140 \
  --unit Bag \
  --rate 279.66 \
  --hsn-code 25322210 \
  --gst-rate 18 \
  --company-gstin "09AAAAA0000A1Z5" \
  --output invoice_186.pdf \
  --no-interactive \
  --json-errors
```

**Backward-compatible `--item` pipe format** (still supported):

```
Description|Qty Unit|Rate|Tax%|HSN
```

Example: `--item "Ambuja Cement|140 Bag|279.66|18%|25322210"` fills item, qty, unit, rate, gst-rate, and hsn-code.

#### Invoice flags reference

| Flag | Description |
|------|-------------|
| `--party-name` / `--party` | Buyer name (required) |
| `--invoice-no`, `--date` | Required |
| `--place-of-supply` | Required — state name or code |
| `--customer-gstin` | Required with `--b2b` |
| `--company-gstin`, `--seller-state` | Seller state for GST split |
| `--item`, `--qty`, `--rate`, `--unit`, `--hsn-code`, `--gst-rate` | Line item (required) |
| `--billing-address`, `--discount`, `--reverse-charge` | Optional |
| `--b2b` | Requires customer GSTIN |
| `--interactive` / `--no-interactive` | TTY prompts vs agent-safe |
| `--json-errors` | Structured validation output |
| `--no-ui` | Disable chalk/spinner/progress |

### 3) Generate generic PDF (receipts / notes)

```bash
tallyca generate:generic \
  --title "Payment Receipt" \
  --body "Payment of ₹39152.40 received from XYZ Build against Invoice 186." \
  --output receipt.pdf
```

## Why you don’t see `src/commands` on npm

This CLI is configured to run commands from the **compiled output**:

- OCLIF is set to load commands from `./dist/commands` (built JS)
- npm publish includes `/dist` (see `package.json` → `"files": ["/dist", ...]`)

So on npm you should see `dist/commands/...` rather than `src/commands/...`.

If you want the TypeScript sources to appear on npm as well, you can add `/src/commands` to the `"files"` list — but it’s not required for the CLI to work.

## Publish (for maintainers)

```bash
npm login
npm publish --access public
```

(`prepack` runs automatically during publish and generates `oclif.manifest.json`.)

