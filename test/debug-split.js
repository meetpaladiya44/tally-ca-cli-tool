import {splitQtyUnit} from '../dist/lib/validation.js';

console.log('Testing splitQtyUnit with various inputs:');
console.log('"140":', splitQtyUnit('140'));
console.log('"140 Bag":', splitQtyUnit('140 Bag'));
console.log('"14":', splitQtyUnit('14'));
console.log('"14 0":', splitQtyUnit('14 0'));
