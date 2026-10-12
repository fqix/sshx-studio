import { spawnSync } from 'child_process';
import * as path from 'path';

const MIT_MAGIC_COOKIE = 'MIT-MAGIC-COOKIE-1';
/** xauth lives here on macOS (XQuartz) and some older systems, often outside the extension host's PATH. */
const EXTRA_PATHS = ['/opt/X11/bin', '/usr/X11/bin', '/usr/X11R6/bin'];

/** The real MIT-MAGIC-COOKIE-1 for `display` from `xauth list`, or undefined if there is none. */
export function readXauthCookie(display: string): Buffer | undefined {
  const env = { ...process.env, PATH: [process.env.PATH, ...EXTRA_PATHS].filter(Boolean).join(path.delimiter) };
  const res = spawnSync('xauth', ['list', display], { env, encoding: 'utf8', timeout: 3000 });
  if (res.status !== 0 || !res.stdout) return undefined;
  for (const line of res.stdout.split('\n')) {
    const [, proto, hex] = line.trim().split(/\s+/);
    if (proto === MIT_MAGIC_COOKIE && /^[0-9a-f]+$/i.test(hex ?? '')) return Buffer.from(hex, 'hex');
  }
  return undefined;
}
