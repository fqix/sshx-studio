import { t } from '../i18n';
import { connect } from '../ssh/connect';
import type { HostResolver, PromptSession, SshConnection } from '../ssh/types';
import type { ForwardRecord } from '../storage/forwardTypes';
import { errorMessage, safe } from '../utils/async';
import { startDynamicForward } from './dynamicForward';
import { formatForwardSpec, forwardFlag } from './forwardSpec';
import { RunningForward, startLocalForward } from './localForward';
import { startRemoteForward } from './remoteForward';

export type ForwardStatus = 'stopped' | 'starting' | 'active' | 'error';

export interface ForwardState {
  status: ForwardStatus;
  /** Bound port while active. */
  port?: number;
  error?: string;
}

interface HostLink {
  connection: SshConnection;
  forwardIds: Set<number>;
}

/**
 * Runs port forwards. Forwards of the same host share one SSH connection,
 * which is opened on the first start and closed when the last forward stops.
 */
export class ForwardManager {
  private readonly links = new Map<string, Promise<HostLink>>();
  private readonly running = new Map<number, { alias: string; forward: RunningForward }>();
  private readonly states = new Map<number, ForwardState>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly resolver: HostResolver,
    private readonly newPromptSession: () => PromptSession,
    private readonly log: (message: string) => void,
  ) {}

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  state(id: number): ForwardState {
    return this.states.get(id) ?? { status: 'stopped' };
  }

  async start(alias: string, rec: ForwardRecord): Promise<void> {
    const current = this.state(rec.id).status;
    if (current === 'active' || current === 'starting') return;
    this.setState(rec.id, { status: 'starting' });
    let link: HostLink | undefined;
    try {
      link = await this.linkFor(alias);
      const start = { local: startLocalForward, remote: startRemoteForward, dynamic: startDynamicForward }[rec.kind];
      const forward = await start(link.connection.client, rec);
      link.forwardIds.add(rec.id);
      this.running.set(rec.id, { alias, forward });
      this.setState(rec.id, { status: 'active', port: forward.port });
      this.log(`[${alias}] ${forwardFlag(rec.kind)} ${formatForwardSpec(rec)} active on port ${forward.port}`);
    } catch (e) {
      this.setState(rec.id, { status: 'error', error: errorMessage(e) });
      this.log(`[${alias}] forward ${formatForwardSpec(rec)} failed: ${errorMessage(e)}`);
      if (link) this.releaseIfIdle(alias, link);
      throw e;
    }
  }

  async stop(id: number): Promise<void> {
    const run = this.running.get(id);
    this.running.delete(id);
    this.setState(id, { status: 'stopped' });
    if (!run) return;
    await run.forward.close().catch(() => {});
    const link = await this.links.get(run.alias)?.catch(() => undefined);
    if (link) {
      link.forwardIds.delete(id);
      this.releaseIfIdle(run.alias, link);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  private linkFor(alias: string): Promise<HostLink> {
    let link = this.links.get(alias);
    if (!link) {
      link = this.openLink(alias);
      this.links.set(alias, link);
      link.catch(() => this.links.delete(alias));
    }
    return link;
  }

  private async openLink(alias: string): Promise<HostLink> {
    const session = this.newPromptSession();
    const connection = await connect(this.resolver, alias, session.prompter);
    await session.onConnected();
    const link: HostLink = { connection, forwardIds: new Set() };
    connection.client.on('close', () => {
      this.links.delete(alias);
      for (const id of link.forwardIds) {
        const run = this.running.get(id);
        this.running.delete(id);
        run?.forward.close().catch(() => {});
        this.setState(id, { status: 'error', error: t('Connection closed') });
      }
    });
    return link;
  }

  private releaseIfIdle(alias: string, link: HostLink) {
    if (link.forwardIds.size) return;
    this.links.delete(alias);
    safe(() => link.connection.dispose());
  }

  private setState(id: number, state: ForwardState) {
    this.states.set(id, state);
    this.listeners.forEach((l) => l());
  }

  dispose() {
    for (const run of this.running.values()) run.forward.close().catch(() => {});
    this.running.clear();
    for (const link of this.links.values()) link.then((l) => safe(() => l.connection.dispose()), () => {});
    this.links.clear();
    this.listeners.clear();
  }
}
