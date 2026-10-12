import * as net from 'net';
import * as path from 'path';

/** Where the local X server listens, parsed from DISPLAY. */
export type X11Display =
  | { kind: 'unix'; path: string; display: string; number: number; screen: number }
  | { kind: 'tcp'; host: string; port: number; display: string; number: number; screen: number };

const X11_TCP_BASE = 6000;

/**
 * Parse DISPLAY like OpenSSH does:
 *   ":0", "unix:0"                    → /tmp/.X11-unix/X0
 *   "/private/tmp/…/org.xquartz:0"    → that socket (XQuartz on macOS)
 *   "localhost:10.0", "host:1"        → TCP port 6000 + n
 * Windows has no DISPLAY by default; X servers there (VcXsrv, Xming) listen on localhost:0.
 */
export function parseDisplay(display = process.env.DISPLAY, platform = process.platform): X11Display | undefined {
  const value = display || (platform === 'win32' ? 'localhost:0.0' : undefined);
  if (!value) return undefined;
  const m = /^(.*):(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return undefined;
  const [, host, num, screen] = m;
  const number = Number(num);
  const common = { display: value, number, screen: Number(screen ?? 0) };
  if (host.startsWith('/')) return { kind: 'unix', path: value, ...common };
  if (host === '' || host === 'unix') return { kind: 'unix', path: path.posix.join('/tmp/.X11-unix', `X${number}`), ...common };
  return { kind: 'tcp', host, port: X11_TCP_BASE + number, ...common };
}

export function connectDisplay(d: X11Display): net.Socket {
  return d.kind === 'unix' ? net.connect(d.path) : net.connect(d.port, d.host);
}
