import type { ForwardKind, ForwardSpec } from '../storage/forwardTypes';
import { t } from '../i18n';

/**
 * Parse ssh's forward syntax:
 *   -L / -R  `[bind_address:]port:host:hostport`
 *   -D       `[bind_address:]port`
 * IPv6 addresses may be bracketed: `[::1]:8080:[fe80::1]:80`.
 */
export function parseForwardSpec(kind: ForwardKind, input: string): ForwardSpec {
  const parts = splitSpec(input.trim());
  if (kind === 'dynamic') {
    if (parts.length !== 1 && parts.length !== 2) throw new Error(t('Expected [bind_address:]port, got "{0}"', input));
    const [bindHost, bindPort] = parts.length === 2 ? parts : ['', parts[0]];
    return { kind, bindHost: bindHost === '*' ? '0.0.0.0' : bindHost, bindPort: port(bindPort), targetHost: '', targetPort: 0 };
  }
  if (parts.length !== 3 && parts.length !== 4) throw new Error(t('Expected [bind_address:]port:host:hostport, got "{0}"', input));
  const [bindHost, bindPort, targetHost, targetPort] = parts.length === 4 ? parts : ['', ...parts];
  return {
    kind,
    bindHost: bindHost === '*' ? '0.0.0.0' : bindHost,
    bindPort: port(bindPort),
    targetHost: requireHost(targetHost),
    targetPort: port(targetPort),
  };
}

/** `LocalForward 8080 db:5432` / `RemoteForward [bind:]port host:hostport` / `DynamicForward [bind:]port` from ssh_config. */
export function parseConfigForward(kind: ForwardKind, value: string): ForwardSpec {
  if (kind === 'dynamic') return parseForwardSpec(kind, value.trim());
  const [listen, target] = value.trim().split(/\s+/);
  if (!listen || !target) throw new Error(t('Invalid port forward: "{0}"', value));
  return parseForwardSpec(kind, `${listen}:${target}`);
}

/** Inverse of parseForwardSpec. */
export function formatForwardSpec(f: ForwardSpec): string {
  const h = (s: string) => (s.includes(':') ? `[${s}]` : s);
  const listen = `${f.bindHost ? h(f.bindHost) + ':' : ''}${f.bindPort}`;
  return f.kind === 'dynamic' ? listen : `${listen}:${h(f.targetHost)}:${f.targetPort}`;
}

/** ssh command-line flag for a forward kind. */
export const forwardFlag = (kind: ForwardKind) => ({ local: '-L', remote: '-R', dynamic: '-D' })[kind];

/** Split on ':' except inside [brackets]. */
function splitSpec(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new Error(t('Unclosed "[" in "{0}"', s));
      cur += s.slice(i + 1, end);
      i = end;
    } else if (c === ':') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function port(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(t('Invalid port "{0}"', s));
  return n;
}

function requireHost(s: string): string {
  if (!s) throw new Error(t('Missing target host'));
  return s;
}
