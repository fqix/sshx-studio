import * as fs from 'fs';
import { AuthHandlerMiddleware, utils } from 'ssh2';
import type { ResolvedHost } from '../config/types';
import type { Prompter } from './types';
import { t } from '../i18n';

/** An auth attempt for ssh2 plus a label for the log; `method` is the SSH method name the server lists. */
type AuthAttempt = { label: string; method: string; auth: Record<string, unknown> & { type: string } };
/** Resolves to an attempt, `null` to skip it, or `false` to abort (user cancelled). */
type AuthStep = () => Promise<AuthAttempt | null | false>;
type KeyboardPrompt = (...args: unknown[]) => void;

const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/**
 * Builds the ordered list of auth attempts for the host's auth method:
 *   auto      → agent, identity files, keyboard-interactive, password
 *   keyFile   → the identity file, then password as fallback
 *   keyStored → the key from SecretStorage, then password as fallback
 *   password  → keyboard-interactive, password
 * A saved password is tried before prompting. `keyboardPrompt` receives ssh2's
 * keyboard-interactive callback arguments (connect.ts re-emits them on the client).
 * Call `notSent()` when ssh2 drops the current attempt locally (e.g. the agent is unreachable),
 * so it isn't logged as rejected by the server.
 */
export function buildAuthHandler(
  host: ResolvedHost,
  prompter: Prompter,
  keyboardPrompt: KeyboardPrompt,
): AuthHandlerMiddleware & { notSent(): void } {
  const m = host.authMethod;
  const steps: AuthStep[] = [
    ...(m === 'auto' ? agentSteps(host) : []),
    ...(m === 'keyStored' && host.secrets.privateKey ? [keyStep(host, Buffer.from(host.secrets.privateKey), 'stored key', prompter)] : []),
    ...(m === 'auto' || m === 'keyFile'
      ? host.identityFiles.filter((f) => fs.existsSync(f)).map((f) => keyStep(host, fs.readFileSync(f), f, prompter))
      : []),
    async () => attempt('keyboard-interactive', { type: 'keyboard-interactive', username: host.user, prompt: keyboardPrompt }),
    ...(host.secrets.password
      ? [async () => attempt('saved password', { type: 'password', username: host.user, password: host.secrets.password })]
      : []),
    promptPasswordStep(host, prompter),
  ];

  let last: string | undefined;
  const handler = ((methodsLeft: string[] | null, partial: boolean | null, callback: (m: unknown) => void) => {
    if (last) {
      const allowed = methodsLeft?.length ? `; server allows: ${methodsLeft.join(', ')}` : '';
      prompter.log(`[${host.alias}] ${partial ? `Server accepted ${last} but requires more` : `Server rejected ${last}`}${allowed}`);
      last = undefined;
    }
    nextAttempt(steps, methodsLeft).then(
      (next) => {
        if (next) {
          last = next.label;
          prompter.log(`[${host.alias}] Trying ${last}`);
        } else if (next === null) {
          prompter.log(`[${host.alias}] No compatible authentication methods remain`);
        }
        callback(next ? next.auth : false);
      },
      (e: unknown) => {
        prompter.log(`[${host.alias}] Authentication step failed: ${e instanceof Error ? e.message : String(e)}`);
        callback(false);
      },
    );
  }) as AuthHandlerMiddleware;
  return Object.assign(handler, { notSent: () => (last = undefined) });
}

const attempt = (label: string, auth: AuthAttempt['auth']): AuthAttempt => ({
  label,
  method: auth.type === 'agent' ? 'publickey' : auth.type,
  auth,
});

/** The next attempt the server accepts; `false` if the user cancelled, `null` if none remain. */
async function nextAttempt(steps: AuthStep[], methodsLeft: string[] | null): Promise<AuthAttempt | false | null> {
  while (steps.length) {
    const next = await steps.shift()!();
    if (next === false) return false;
    if (!next) continue;
    if (methodsLeft && !methodsLeft.includes(next.method)) continue;
    return next;
  }
  return null;
}

/** The SSH agent to use for this host (IdentityAgent, SSH_AUTH_SOCK, or the Windows OpenSSH agent). */
export function agentPath(host: ResolvedHost): string | undefined {
  return host.identityAgent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === 'win32' ? WINDOWS_AGENT_PIPE : undefined);
}

/** An unreachable agent is not fatal: ssh2 reports it as a `level: 'agent'` error and moves on (see handshake.ts). */
function agentSteps(host: ResolvedHost): AuthStep[] {
  const agent = agentPath(host);
  if (!agent || host.identitiesOnly) return [];
  return [async () => attempt('SSH agent keys', { type: 'agent', username: host.user, agent })];
}

/** Public-key attempt; for encrypted keys uses the saved passphrase or asks for one. */
function keyStep(host: ResolvedHost, key: Buffer, label: string, prompter: Prompter): AuthStep {
  return async () => {
    const parsed = utils.parseKey(key);
    if (!(parsed instanceof Error)) {
      if (parsed.isPrivateKey()) return attempt(`public key from ${label}`, { type: 'publickey', username: host.user, key });
      prompter.log(`[${host.alias}] ${label}: not a private key`);
      return null;
    }
    if (!isEncryptedKeyError(parsed)) {
      prompter.log(`[${host.alias}] ${label}: ${parsed.message}`);
      return null;
    }
    for (const candidate of [host.secrets.passphrase, undefined]) {
      const passphrase = candidate ?? (await prompter.passphrase(host, label));
      if (!passphrase) continue;
      if (!(utils.parseKey(key, passphrase) instanceof Error)) return attempt(`public key from ${label}`, { type: 'publickey', username: host.user, key, passphrase });
      prompter.log(`[${host.alias}] ${label}: wrong passphrase`);
    }
    return null;
  };
}

export const isEncryptedKeyError = (e: Error) => /encrypted|passphrase/i.test(e.message);

function promptPasswordStep(host: ResolvedHost, prompter: Prompter): AuthStep {
  return async () => {
    const password = await prompter.password(host, t('Password for {0}', `${host.user}@${host.hostname}`));
    return password === undefined ? false : attempt('password', { type: 'password', username: host.user, password });
  };
}
