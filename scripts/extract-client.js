const fs = require('fs');
const h = fs.readFileSync('client/public/index.html', 'utf8');
const m = h.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('no module script found'); process.exit(1); }
fs.writeFileSync(process.argv[2], m[1]);
console.log('extracted', m[1].length, 'chars');
