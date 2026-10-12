// Downloads built-in sample videos into client/public/media/.
// Run: npm run fetch-media
// These are small, freely-licensed trailers served same-origin so rooms
// always have something playable without internet or third-party hosts.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'client', 'public', 'media');
mkdirSync(outDir, { recursive: true });

const FILES = [
  { name: 'flower.mp4', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
  { name: 'sintel-trailer.mp4', url: 'https://media.w3.org/2010/05/sintel/trailer.mp4' },
];

for (const f of FILES) {
  const dest = path.join(outDir, f.name);
  if (existsSync(dest) && statSync(dest).size > 100000) {
    console.log(`skip ${f.name} (already ${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
    continue;
  }
  console.log(`downloading ${f.name}...`);
  const res = await fetch(f.url);
  if (!res.ok || !res.body) throw new Error(`fetch failed ${f.url}: ${res.status}`);
  const ws = createWriteStream(dest);
  await res.body.pipeTo(new (await import('stream/web')).WritableStream({
    write: (c) => new Promise((ok, bad) => ws.write(Buffer.from(c), (e) => (e ? bad(e) : ok()))),
    close: () => new Promise((ok) => ws.end(ok)),
  }));
  console.log(`saved ${f.name} (${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
}
console.log('done.');
