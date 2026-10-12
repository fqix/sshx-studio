import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  // ssh2 optionally loads these native addons inside try/catch; its pure-JS fallback is used.
  external: ['vscode', 'cpu-features', '*.node'],
};

const configs = test
  ? [{ ...node, entryPoints: ['test/e2e.ts'], outfile: 'out/e2e.js' }]
  : [{ ...node, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' }];

// Ship better-sqlite3's prebuilt N-API binaries for every platform next to the bundle;
// src/storage/nativeBinding.ts picks the right one at runtime.
const PREBUILDS = 'node_modules/better-sqlite3/prebuilds';
for (const c of configs) {
  const nativeDir = join(dirname(c.outfile), 'native');
  mkdirSync(nativeDir, { recursive: true });
  for (const f of readdirSync(PREBUILDS).filter((f) => f.endsWith('.node'))) copyFileSync(join(PREBUILDS, f), join(nativeDir, f));
  execFileSync(process.execPath, ['scripts/check-native.mjs', '--all', nativeDir], { stdio: 'inherit' });
}

if (watch) {
  for (const c of configs) (await esbuild.context(c)).watch();
  console.log('watching...');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log('build ok');
}
