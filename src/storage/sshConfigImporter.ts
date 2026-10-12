import { SshConfig } from '../config/sshConfig';
import { parseConfigForward } from '../forward/forwardSpec';
import { ForwardRepository } from './forwardRepository';
import type { ForwardKind, ForwardSpec } from './forwardTypes';
import type { HostRepository } from './hostRepository';
import type { NewHost } from './types';

/** Options stored elsewhere (columns / port_forwards); everything else goes into `options`. */
const COLUMN_KEYS = new Set(['hostname', 'port', 'user', 'identityfile', 'proxyjump', 'proxycommand', 'localforward', 'remoteforward', 'dynamicforward']);
const IMPORTED_FLAG = 'sshConfigImportedAt';

/** Convert every concrete Host in an ssh config into a database row (token expansion is deferred to connect time). */
export function hostsFromSshConfig(config: SshConfig): NewHost[] {
  return config.listHosts().map((alias) => {
    const all = config.optionMap(alias);
    const options = Object.fromEntries(Object.entries(all).filter(([k]) => !COLUMN_KEYS.has(k)));
    const opts = config.options(alias);
    return {
      alias,
      hostname: opts.first('hostname') ?? alias,
      port: parseInt(opts.first('port') ?? '22', 10) || 22,
      username: opts.first('user') ?? '',
      authMethod: 'auto',
      identityFile: opts.first('identityfile') ?? '',
      publicKey: '',
      proxyJump: opts.first('proxyjump') ?? '',
      proxyCommand: opts.verbatim('proxycommand') ?? '',
      options,
      source: 'ssh-config',
    };
  });
}

/** LocalForward / RemoteForward / DynamicForward lines of a host; malformed ones are skipped. */
export function forwardsFromSshConfig(config: SshConfig, alias: string): ForwardSpec[] {
  const parse = (kind: ForwardKind, key: string) =>
    config.values(alias, key).flatMap((v) => {
      try {
        return [parseConfigForward(kind, v)];
      } catch {
        return [];
      }
    });
  return [...parse('local', 'localforward'), ...parse('remote', 'remoteforward'), ...parse('dynamic', 'dynamicforward')];
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** Import hosts (and their forwards) whose alias isn't in the database yet — all in one transaction. */
export async function importSshConfig(hosts: HostRepository, configPath: string): Promise<ImportResult> {
  const config = new SshConfig(configPath);
  const candidates = hostsFromSshConfig(config);
  const inserted = await hosts.insertMissing(candidates, (tx, hostId, host) => {
    for (const f of forwardsFromSshConfig(config, host.alias)) {
      ForwardRepository.insertIn(tx, { ...f, hostId, label: '', autoStart: false });
    }
  });
  await hosts.setMeta(IMPORTED_FLAG, String(Date.now()));
  return { imported: inserted.size, skipped: candidates.length - inserted.size };
}

/** First run only: seed the database from the ssh config. Undefined if that already happened. */
export async function importOnFirstRun(hosts: HostRepository, configPath: string): Promise<ImportResult | undefined> {
  if (await hosts.getMeta(IMPORTED_FLAG)) return undefined;
  return importSshConfig(hosts, configPath);
}
