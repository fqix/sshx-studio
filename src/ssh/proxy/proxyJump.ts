import type { Duplex } from 'stream';
import type { ResolvedHost } from '../../config/types';
import type { HostResolver, SshConnection } from '../types';

/**
 * For `ProxyJump a,b,c` the target is reached via c, which is reached via b via a.
 * Returns the last hop, with the remaining hops (if any) set as its own ProxyJump.
 */
export async function resolveLastHop(resolver: HostResolver, proxyJump: string): Promise<ResolvedHost> {
  const hops = proxyJump
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const last = await parseJumpSpec(resolver, hops.pop()!);
  // The remaining hops replace whatever the jump host itself has configured.
  if (hops.length) {
    last.proxyJump = hops.join(',');
    last.proxyCommand = undefined;
  }
  return last;
}

/** A ProxyJump entry is either a config alias or `[user@]host[:port]`. */
export async function parseJumpSpec(resolver: HostResolver, spec: string): Promise<ResolvedHost> {
  const m = /^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(spec);
  if (!m) return resolver.resolve(spec);
  const [, user, hostPart, port] = m;
  const host = { ...(await resolver.resolve(hostPart.replace(/^\[|\]$/g, ''))) };
  if (user) host.user = user;
  if (port) host.port = parseInt(port, 10);
  return host;
}

/** Open a direct-tcpip channel through `jump` to the target host. */
export function forwardThrough(jump: SshConnection, target: ResolvedHost): Promise<Duplex> {
  return new Promise((resolve, reject) =>
    jump.client.forwardOut('127.0.0.1', 0, target.hostname, target.port, (err, ch) => (err ? reject(err) : resolve(ch))),
  );
}
