import type { Duplex } from 'stream';
import { Client } from 'ssh2';
import type { ResolvedHost } from '../config/types';
import { safe } from '../utils/async';
import { agentPath, buildAuthHandler } from './auth';
import { answerKeyboardInteractive, handshake, PromptTracker } from './handshake';
import { verifyHostKey } from './knownHosts';
import { ProxyCommandStream } from './proxy/proxyCommandStream';
import { forwardThrough, resolveLastHop } from './proxy/proxyJump';
import type { HostResolver, Prompter, SshConnection } from './types';
import { t } from '../i18n';

const MAX_JUMP_DEPTH = 8;
const DEFAULT_TIMEOUT_S = 20;
const DEFAULT_KEEPALIVE_MS = 15000;

/** Connect to `alias`, honoring ProxyCommand / ProxyJump. */
export async function connect(resolver: HostResolver, alias: string, prompter: Prompter): Promise<SshConnection> {
  return connectHost(resolver, await resolver.resolve(alias), prompter, 0);
}

async function connectHost(resolver: HostResolver, host: ResolvedHost, prompter: Prompter, depth: number): Promise<SshConnection> {
  if (depth > MAX_JUMP_DEPTH) throw new Error(t('ProxyJump chain too deep'));
  const cleanup: (() => void)[] = [];
  const disposeAll = () => cleanup.reverse().forEach(safe);

  try {
    const sock = await openTransport(resolver, host, prompter, depth, cleanup);
    const client = new Client();
    cleanup.push(() => client.end());

    const tracker = new PromptTracker();
    const ui = tracker.wrap(prompter);
    answerKeyboardInteractive(client, host, ui);
    const authHandler = buildAuthHandler(host, ui, (...args) => client.emit('keyboard-interactive', ...args));

    await handshake(
      client,
      {
        host: host.hostname,
        port: host.port,
        username: host.user,
        sock,
        keepaliveInterval: host.serverAliveInterval ? host.serverAliveInterval * 1000 : DEFAULT_KEEPALIVE_MS,
        tryKeyboard: true,
        ...agentForwarding(host, prompter),
        authHandler,
        hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
          verifyHostKey(host, key, ui).then(verify, (e) => {
            prompter.log(`[${host.alias}] ${e.message}`);
            verify(false);
          });
        },
      },
      (host.connectTimeout ?? DEFAULT_TIMEOUT_S) * 1000,
      tracker,
      (e) => (sock instanceof ProxyCommandStream && sock.stderr ? `${e.message}\nProxyCommand stderr: ${sock.stderr.trim()}` : e.message),
      (e) => {
        authHandler.notSent();
        prompter.log(`[${host.alias}] SSH agent unavailable, skipping it: ${e.message}`);
      },
    );

    prompter.log(`[${host.alias}] connected to ${host.user}@${host.hostname}:${host.port}`);
    return { client, host, dispose: disposeAll };
  } catch (e) {
    disposeAll();
    throw e;
  }
}

/** ForwardAgent: let the server use our agent through this connection's sessions. */
function agentForwarding(host: ResolvedHost, prompter: Prompter): { agent?: string; agentForward?: boolean } {
  if (!host.forwardAgent) return {};
  const agent = typeof host.forwardAgent === 'string' ? host.forwardAgent : agentPath(host);
  if (!agent) {
    prompter.log(`[${host.alias}] ForwardAgent requested but no SSH agent is available (SSH_AUTH_SOCK is not set)`);
    return {};
  }
  return { agent, agentForward: true };
}

/** The socket to run SSH over: a ProxyCommand process, a channel through a jump host, or direct TCP (undefined). */
async function openTransport(
  resolver: HostResolver,
  host: ResolvedHost,
  prompter: Prompter,
  depth: number,
  cleanup: (() => void)[],
): Promise<Duplex | undefined> {
  if (host.proxyCommand) {
    prompter.log(`[${host.alias}] ProxyCommand: ${host.proxyCommand}`);
    const stream = new ProxyCommandStream(host.proxyCommand);
    cleanup.push(() => stream.destroy());
    return stream;
  }
  if (host.proxyJump) {
    const hop = await resolveLastHop(resolver, host.proxyJump);
    prompter.log(`[${host.alias}] ProxyJump via ${hop.alias}`);
    const jump = await connectHost(resolver, hop, prompter, depth + 1);
    cleanup.push(() => jump.dispose());
    return forwardThrough(jump, host);
  }
  return undefined;
}
