import * as os from 'os';
import * as path from 'path';
import { expandHome, expandTokens } from './tokens';
import type { AuthMethod, HostSecrets, ResolvedHost } from './types';

const DEFAULT_IDENTITIES = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

/** Read access to ssh_config-style options (lowercase keywords). */
export interface OptionSource {
  /** First argument of the first occurrence. */
  first(key: string): string | undefined;
  /** Everything after the keyword, verbatim (for ProxyCommand). */
  verbatim(key: string): string | undefined;
  /** All arguments of all occurrences (for multi-value keys like IdentityFile). */
  all(key: string): string[];
}

/** Turn options into a ResolvedHost, applying OpenSSH defaults and %-token expansion. */
export function resolveOptions(
  alias: string,
  opts: OptionSource,
  extra: { id?: number; authMethod?: AuthMethod; secrets?: HostSecrets } = {},
): ResolvedHost {
  const num = (k: string) => (opts.first(k) ? parseInt(opts.first(k)!, 10) : undefined);
  const notNone = (v?: string) => (v && v.toLowerCase() !== 'none' ? v : undefined);

  const user = opts.first('user') || os.userInfo().username;
  const port = num('port') ?? 22;
  const expand = (s: string, hostname: string) => expandTokens(s, { h: hostname, p: String(port), r: user, n: alias });
  const hostname = expand(opts.first('hostname') || alias, alias);
  const tk = (s: string) => expand(s, hostname);

  const identityFiles = opts.all('identityfile').map((f) => expandHome(tk(f)));
  const proxyCommand = notNone(opts.verbatim('proxycommand'));
  const identityAgent = opts.first('identityagent');

  return {
    id: extra.id,
    alias,
    hostname,
    port,
    user,
    authMethod: extra.authMethod ?? 'auto',
    identityFiles: identityFiles.length ? identityFiles : DEFAULT_IDENTITIES.map((f) => path.join(os.homedir(), '.ssh', f)),
    proxyCommand: proxyCommand && tk(proxyCommand),
    proxyJump: notNone(opts.first('proxyjump')),
    identitiesOnly: opts.first('identitiesonly')?.toLowerCase() === 'yes',
    identityAgent: identityAgent && expandHome(tk(identityAgent)),
    connectTimeout: num('connecttimeout'),
    strictHostKeyChecking: (opts.first('stricthostkeychecking') ?? 'ask').toLowerCase(),
    knownHostsFile: expandHome(tk(opts.first('userknownhostsfile') ?? '~/.ssh/known_hosts')),
    serverAliveInterval: num('serveraliveinterval'),
    forwardAgent: forwardAgent(opts.first('forwardagent'), tk),
    forwardX11: opts.first('forwardx11')?.toLowerCase() === 'yes',
    secrets: extra.secrets ?? {},
  };
}

/** `ForwardAgent yes|no|<socket path>|$ENV_VAR` */
function forwardAgent(value: string | undefined, tk: (s: string) => string): boolean | string {
  if (!value) return false;
  const v = value.toLowerCase();
  if (v === 'yes') return true;
  if (v === 'no') return false;
  if (value.startsWith('$')) return process.env[value.slice(1)] ?? false;
  return expandHome(tk(value));
}

/** OptionSource over a flat `{ keyword: value }` map (values verbatim). */
export function optionsFromRecord(values: Record<string, string | undefined>): OptionSource {
  const get = (k: string) => (values[k] === undefined || values[k] === '' ? undefined : values[k]);
  return {
    first: (k) => get(k)?.trim().split(/\s+/)[0]?.replace(/^"(.*)"$/, '$1'),
    verbatim: get,
    all: (k) => (get(k) ? [get(k)!] : []),
  };
}
