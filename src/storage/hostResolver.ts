import { optionsFromRecord, resolveOptions } from '../config/resolveOptions';
import type { SshConfig } from '../config/sshConfig';
import type { ResolvedHost } from '../config/types';
import type { HostResolver } from '../ssh/types';
import type { HostRepository } from './hostRepository';
import type { HostSecretStore } from './secretStore';
import type { HostRecord } from './types';

/**
 * Resolves aliases from the database (with secrets from the keychain).
 * Aliases not in the database — e.g. a ProxyJump to a host that was never imported — fall back to the ssh config.
 */
export class DatabaseHostResolver implements HostResolver {
  constructor(
    private readonly repo: HostRepository,
    private readonly secrets: HostSecretStore,
    private readonly fallback: () => SshConfig,
  ) {}

  async resolve(alias: string): Promise<ResolvedHost> {
    const record = await this.repo.findByAlias(alias);
    if (!record) return this.fallback().resolve(alias);
    return resolveRecord(record, await this.secrets.load(record.id));
  }
}

export function resolveRecord(record: HostRecord, secrets: ResolvedHost['secrets'] = {}): ResolvedHost {
  const opts = optionsFromRecord({
    ...record.options,
    hostname: record.hostname,
    port: String(record.port),
    user: record.username,
    identityfile: record.authMethod === 'keyStored' ? '' : record.identityFile,
    proxyjump: record.proxyJump,
    proxycommand: record.proxyCommand,
  });
  return resolveOptions(record.alias, opts, { id: record.id, authMethod: record.authMethod, secrets });
}
