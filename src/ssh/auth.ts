import * as fs from 'fs';
import { AuthHandlerMiddleware, utils } from 'ssh2';
import type { ResolvedHost } from '../config/types';
import type { Prompter } from './types';
import { t } from '../i18n';

/** An auth attempt, `null` to skip it, or `false` to abort (user cancelled). */
type AuthAttempt = Record<string, unknown> & { type: string };
type AuthStep = () => Promise<AuthAttempt | null | false>;

const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/**
 * Builds the ordered list of auth attempts for the host's auth method:
 *   auto      → agent, identity files, keyboard-interactive, password
 *   keyFile   → the identity file, then password as fallback
 *   keyStored → the key from SecretStorage, then password as fallback
 *   password  → keyboard-interactive, password
 * A saved password is tried before prompting.
 */
export function buildAuthHandler(host: ResolvedHost, prompter: Prompter): AuthHandlerMiddleware {
  const m = host.authMethod;
  const steps: AuthStep[] = [
    ...(m === 'auto' ? agentSteps(host) : []),
    ...(m === 'keyStored' && host.secrets.privateKey ? [keyStep(host, Buffer.from(host.secrets.privateKey), 'stored key', prompter)] : []),
    ...(m === 'auto' || m === 'keyFile'
      ? host.identityFiles.filter((f) => fs.existsSync(f)).map((f) => keyStep(host, fs.readFileSync(f), f, prompter))
      : []),
    async () => ({ type: 'keyboard-interactive', username: host.user }),
    ...(host.secrets.password ? [async () => ({ type: 'password', username: host.user, password: host.secrets.password })] : []),
    promptPasswordStep(host, prompter),
  ];

  return ((methodsLeft: string[] | null, _partial: boolean | null, callback: (m: unknown) => void) => {
    nextAttempt(steps, methodsLeft).then(callback, () => callback(false));
  }) as AuthHandlerMiddleware;
}

async function nextAttempt(steps: AuthStep[], methodsLeft: string[] | null): Promise<AuthAttempt | false> {
  while (steps.length) {
    const attempt = await steps.shift()!();
    if (attempt === false) return false;
    if (!attempt) continue;
    const method = attempt.type === 'agent' ? 'publickey' : attempt.type;
    if (methodsLeft && !methodsLeft.includes(method)) continue;
    return attempt;
  }
  return false;
}

/** The SSH agent to use for this host (IdentityAgent, SSH_AUTH_SOCK, or the Windows OpenSSH agent). */
export function agentPath(host: ResolvedHost): string | undefined {
  return host.identityAgent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? WINDOWS_AGENT_PIPE : undefined);
}

function agentSteps(host: ResolvedHost): AuthStep[] {
  const agent = agentPath(host);
  if (!agent || host.identitiesOnly) return [];
  return [async () => ({ type: 'agent', username: host.user, agent })];
}

/** Public-key attempt; for encrypted keys uses the saved passphrase or asks for one. */
function keyStep(host: ResolvedHost, key: Buffer, label: string, prompter: Prompter): AuthStep {
  return async () => {
    const parsed = utils.parseKey(key);
    if (!(parsed instanceof Error)) return { type: 'publickey', username: host.user, key };
    if (!isEncryptedKeyError(parsed)) {
      prompter.log(`[${host.alias}] ${label}: ${parsed.message}`);
      return null;
    }
    for (const candidate of [host.secrets.passphrase, undefined]) {
      const passphrase = candidate ?? (await prompter.passphrase(host, label));
      if (!passphrase) continue;
      if (!(utils.parseKey(key, passphrase) instanceof Error)) return { type: 'publickey', username: host.user, key, passphrase };
      prompter.log(`[${host.alias}] ${label}: wrong passphrase`);
    }
    return null;
  };
}

export const isEncryptedKeyError = (e: Error) => /encrypted|passphrase/i.test(e.message);

function promptPasswordStep(host: ResolvedHost, prompter: Prompter): AuthStep {
  return async () => {
    const password = await prompter.password(host, t('Password for {0}', `${host.user}@${host.hostname}`));
    return password === undefined ? false : { type: 'password', username: host.user, password };
  };
}
