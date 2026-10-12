import { Client, ConnectConfig } from 'ssh2';
import type { ResolvedHost } from '../config/types';
import type { Prompter } from './types';
import { t } from '../i18n';

const TICK_MS = 500;

/**
 * Wraps a Prompter so the handshake timer can tell when the user is answering a dialog.
 * (ssh2's own readyTimeout would count that time and abort slow typists.)
 */
export class PromptTracker {
  private active = 0;

  get prompting() {
    return this.active > 0;
  }

  wrap(prompter: Prompter): Prompter {
    const track = <T>(p: Promise<T>) => (this.active++, p.finally(() => this.active--));
    return {
      password: (h, m) => track(prompter.password(h, m)),
      passphrase: (h, k) => track(prompter.passphrase(h, k)),
      confirmHostKey: (h, fp) => track(prompter.confirmHostKey(h, fp)),
      log: prompter.log,
    };
  }
}

/**
 * `client.connect()` and wait for 'ready'. Times out after `timeoutMs` of handshake time,
 * not counting time spent in prompts. `describeError` can enrich failures (e.g. ProxyCommand stderr).
 */
export function handshake(
  client: Client,
  config: ConnectConfig,
  timeoutMs: number,
  tracker: PromptTracker,
  describeError: (e: Error) => string = (e) => e.message,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const timer = setInterval(() => {
      if (tracker.prompting) return;
      elapsed += TICK_MS;
      if (elapsed >= timeoutMs) fail(new Error(t('Timed out after {0}s waiting for handshake', timeoutMs / 1000)));
    }, TICK_MS);

    const fail = (e: Error) => {
      clearInterval(timer);
      reject(new Error(describeError(e)));
    };
    client.once('ready', () => {
      clearInterval(timer);
      client.off('error', fail);
      resolve();
    });
    client.once('error', fail);
    client.connect({ ...config, readyTimeout: 0 });
  });
}

/**
 * Answer keyboard-interactive prompts through the Prompter. A single "Password:" prompt is
 * answered once with the saved password (if any) before asking the user.
 */
export function answerKeyboardInteractive(client: Client, host: ResolvedHost, prompter: Prompter) {
  let savedPasswordUsed = false;
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    (async () => {
      if (host.secrets.password && !savedPasswordUsed && prompts.length === 1 && /password/i.test(prompts[0].prompt)) {
        savedPasswordUsed = true;
        return finish([host.secrets.password]);
      }
      const answers: string[] = [];
      for (const p of prompts) answers.push((await prompter.password(host, `[${host.alias}] ${p.prompt}`)) ?? '');
      finish(answers);
    })();
  });
}
