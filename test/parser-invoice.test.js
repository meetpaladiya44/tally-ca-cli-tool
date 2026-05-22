import {parseToSalesInput} from '../dist/lib/parser.js';
import {validateAndCompute} from '../dist/lib/invoice-schema.js';

const text = `Party Name: ABC Traders
Invoice number: 999
Party Name         : XYZ Build
Invoice No.        : 186
Date               : 2/1/2030
Supplier GSTIN     : 24AABCT1332L1ZX
Customer GSTIN     : 24AAXYZ9876K1ZP
Billing Address    : PQR Build, 4444 Industrial Estate, Pandesara, Surat, Gujarat - 394221
Shipping Address   : PQR Build, 4444 Industrial Estate, Pandesara, Surat, Gujarat - 394221
Place of Supply    : Gujarat (24)
Item               : Ambuja Cement
HSN Code           : 25232910
Qty                : 140 Bag
Rate               : 279.66/Bag
Taxable Value      : 39152.40
Discount           : 0.00
GST Rate           : 18%
CGST               : 3523.72 (9%)
SGST               : 3523.72 (9%)
IGST               : 0.00
Reverse Charge     : No
Voucher Class      : Sales @ 18%
Authorised Signatory: Rajesh Mehta (Proprietor, ABC Traders)`;

console.log('=== Testing Parser Fixes ===\n');

const input = parseToSalesInput(text);
let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    console.log(`✓ ${name}: ${actual}`);
    passed++;
  } else {
    console.log(`✗ ${name}: expected "${expected}", got "${actual}"`);
    failed++;
  }
}

test('partyName (should be XYZ Build, not ABC Traders)', input.partyName, 'XYZ Build');
test('companyGstin (Supplier GSTIN)', input.companyGstin, '24AABCT1332L1ZX');
test('customerGstin (Customer GSTIN)', input.customerGstin, '24AAXYZ9876K1ZP');
test('qty (should be 140, not 14)', input.qty, '140');
test('unit (should be Bag, not 0)', input.unit, 'Bag');
test('billingAddress exists', input.billingAddress ? 'exists' : 'missing', 'exists');
test('shippingAddress exists', input.shippingAddress ? 'exists' : 'missing', 'exists');

console.log('\n=== Testing validateAndCompute ===\n');

const computed = validateAndCompute(input);
test('computed qty', String(computed.qty), '140');
test('computed unit', computed.unit, 'Bag');

const expectedTotalValue = 140 * 279.66; // 39152.40
test('totalValue', computed.totalValue.toFixed(2), expectedTotalValue.toFixed(2));

const expectedGrandTotal = expectedTotalValue + (expectedTotalValue * 0.18); // ~46199.83
test('grandTotal (approx 46200)', Math.round(computed.grandTotal), Math.round(expectedGrandTotal));

console.log('\n=== Testing merge behavior (text wins over flags) ===\n');

// Simulate mergeFlagOverrides behavior (fill-missing-only)
function mergeFlagOverrides(base, flags) {
  const fillMissingOnly = [
    'invoiceNo', 'date', 'partyName', 'placeOfSupply', 'customerGstin',
    'hsnCode', 'item', 'qty', 'rate', 'unit', 'gstRate',
    'billingAddress', 'shippingAddress', 'discount', 'reverseCharge',
    'voucherClass', 'narration',
  ];
  const result = {...base};
  for (const key of fillMissingOnly) {
    const baseVal = base[key];
    const flagVal = flags[key];
    const baseEmpty = baseVal === undefined || baseVal === '' || baseVal === null;
    if (baseEmpty && flagVal !== undefined && flagVal !== '' && flagVal !== false) {
      result[key] = flagVal;
    }
  }
  return result;
}

// Test: text parses qty=140, but flags have qty=14 - text should win (fill-missing-only)
const textInput = parseToSalesInput(text);
const flagInput = { qty: '14', unit: '0' };
const merged = mergeFlagOverrides(textInput, flagInput);

test('merge: text qty (140) wins over flag qty (14)', merged.qty, '140');
test('merge: text unit (Bag) wins over flag unit (0)', merged.unit, 'Bag');

// Test: if text is missing invoice-no, flag should fill it
const textWithMissingNo = parseToSalesInput(text.replace('Invoice No.        : 186', ''));
const fillFlags = { invoiceNo: '999' };
const filledMerged = mergeFlagOverrides(textWithMissingNo, fillFlags);
test('merge: flag invoiceNo fills missing text invoiceNo', filledMerged.invoiceNo, '999');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
