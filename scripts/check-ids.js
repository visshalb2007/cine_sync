const fs = require('fs');
const h = fs.readFileSync('client/public/index.html', 'utf8');
// ids defined in markup
const defined = new Set([...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
// ids referenced in JS
const refs = new Set([...h.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
let fail = 0;
for (const r of [...refs].sort()) {
  if (!defined.has(r)) { console.error('MISSING id:', r); fail = 1; }
}
console.log(refs.size + ' ids referenced, ' + (fail ? 'MISSING FOUND' : 'all defined'));
process.exit(fail);
