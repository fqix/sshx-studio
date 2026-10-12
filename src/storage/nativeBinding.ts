import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

/**
 * Loads better-sqlite3's prebuilt binary for the current platform.
 *
 * better-sqlite3 ships N-API prebuilds for every platform (node_modules/better-sqlite3/prebuilds);
 * the build copies all of them to dist/native/, so one VSIX runs everywhere. N-API keeps them
 * working across VS Code / Electron upgrades without rebuilding.
 */

/** Keep in sync with scripts/native-targets.mjs. */
export const NATIVE_TARGETS = [
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'linuxmusl-x64',
  'linuxmusl-arm64',
  'win32-x64',
  'win32-arm64',
] as const;

/** better-sqlite3's prebuild name for this machine, e.g. "darwin-arm64", "linuxmusl-x64". */
export function currentTarget(): string {
  const platform = process.platform === 'linux' && isMusl() ? 'linuxmusl' : process.platform;
  return `${platform}-${process.arch}`;
}

/** glibc reports its version in the process report; musl (Alpine) doesn't. */
function isMusl(): boolean {
  try {
    const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
    return !header?.glibcVersionRuntime;
  } catch {
    return fs.existsSync('/etc/alpine-release');
  }
}

let addon: object | undefined;

/** The native addon, passed to better-sqlite3 as `nativeBinding`. */
export function loadNativeSqlite(): object {
  if (addon) return addon;
  const target = currentTarget();
  // __dirname is the bundle's directory (dist/ for the extension, out/ for tests).
  const dir = path.join(__dirname, 'native');
  const file = path.join(dir, `${target}.node`);
  if (!fs.existsSync(file)) {
    const available = fs.existsSync(dir) ? fs.readdirSync(dir).join(', ') : 'none';
    throw new Error(`SQLite is not available for ${target} (looked for ${file}; available: ${available}).`);
  }
  // createRequire keeps esbuild from trying to bundle the dynamic path.
  addon = createRequire(__filename)(file) as object;
  return addon;
}
