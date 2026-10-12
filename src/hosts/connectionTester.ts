import type { ResolvedHost } from '../config/types';
import { t } from '../i18n';
import { RemoteFs } from '../sftp/remoteFs';
import { connect } from '../ssh/connect';
import type { HostResolver, Prompter } from '../ssh/types';
import { errorMessage } from '../utils/async';

export interface TestResult {
  ok: boolean;
  /** One-line summary. */
  message: string;
  /** Extra lines (SFTP status, route, …). */
  details: string[];
}

/**
 * Connect to `host` (as described by the editor, not necessarily saved), check SFTP, disconnect.
 * Jump hosts named in its ProxyJump are looked up with `resolver` as usual.
 */
export async function testConnection(host: ResolvedHost, resolver: HostResolver, prompter: Prompter): Promise<TestResult> {
  const route: HostResolver = { resolve: (alias) => (alias === host.alias ? host : resolver.resolve(alias)) };
  const started = Date.now();
  let conn;
  try {
    conn = await connect(route, host.alias, prompter);
  } catch (e) {
    return { ok: false, message: t('Connection failed: {0}', errorMessage(e)), details: [] };
  }
  const elapsed = Date.now() - started;
  const details: string[] = [];
  if (host.proxyJump) details.push(t('Via ProxyJump {0}', host.proxyJump));
  else if (host.proxyCommand) details.push(t('Via ProxyCommand'));
  try {
    const rfs = await RemoteFs.open(conn.client);
    const home = await rfs.realpath('.').catch(() => '/');
    rfs.end();
    details.push(t('SFTP available (home: {0})', home));
  } catch (e) {
    details.push(t('SFTP unavailable: {0}', errorMessage(e)));
  } finally {
    conn.dispose();
  }
  return { ok: true, message: t('Connected to {0} in {1} ms', `${host.user}@${host.hostname}:${host.port}`, elapsed), details };
}
