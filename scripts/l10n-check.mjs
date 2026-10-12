// Extracts every t('…') message from src/ and checks each locale bundle in l10n/ covers it.
// Usage: node scripts/l10n-check.mjs [--write]   (--write regenerates l10n/bundle.l10n.json)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const re = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

const messages = new Set();
for (const f of files('src').filter((f) => f.endsWith('.ts'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(re)) messages.add(JSON.parse(`"${m[2].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`));
}
const sorted = [...messages].sort();

if (process.argv.includes('--write')) {
  writeFileSync('l10n/bundle.l10n.json', JSON.stringify(Object.fromEntries(sorted.map((m) => [m, m])), null, 2) + '\n');
}

let missing = 0;
for (const bundle of readdirSync('l10n').filter((f) => /^bundle\.l10n\..+\.json$/.test(f))) {
  const translated = JSON.parse(readFileSync(join('l10n', bundle), 'utf8'));
  const gaps = sorted.filter((m) => !(m in translated));
  const stale = Object.keys(translated).filter((k) => !messages.has(k));
  for (const g of gaps) console.log(`${bundle}: missing  ${JSON.stringify(g)}`);
  for (const s of stale) console.log(`${bundle}: unused   ${JSON.stringify(s)}`);
  missing += gaps.length;
}
console.log(`${sorted.length} messages, ${missing} missing translation(s)`);
process.exit(missing ? 1 : 0);
