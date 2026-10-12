import * as vscode from 'vscode';
import type { ResolvedHost } from '../config/types';
import { t } from '../i18n';
import type { PromptSession } from '../ssh/types';
import type { HostSecretStore } from '../storage/secretStore';

/**
 * VS Code dialogs for one connection attempt. Passwords / passphrases the user types for
 * hosts in the database are remembered, and after a successful login we offer to save them.
 */
export function createPromptSession(output: vscode.OutputChannel, secrets: HostSecretStore): PromptSession {
  const typed = new Map<number, { alias: string; password?: string; passphrase?: string }>();
  const remember = (host: ResolvedHost, kind: 'password' | 'passphrase', value: string | undefined) => {
    if (value && host.id !== undefined) typed.set(host.id, { ...typed.get(host.id), alias: host.alias, [kind]: value });
    return value;
  };
  const secret = (prompt: string) => vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true });

  return {
    prompter: {
      password: async (host, message) => remember(host, 'password', await secret(message)),
      passphrase: async (host, keyLabel) => remember(host, 'passphrase', await secret(t('Passphrase for {0}', keyLabel))),
      confirmHostKey: async (host, fp) => {
        const trust = t('Trust & Connect');
        const choice = await vscode.window.showWarningMessage(
          t('Unknown host key for {0}', host),
          { modal: true, detail: t('{0}\n\nAdd it to known_hosts and continue?', fp) },
          trust,
        );
        return choice === trust;
      },
      log: (m) => output.appendLine(m),
    },
    // Not awaited by callers' critical path: the question shouldn't block the session.
    onConnected: async () => {
      for (const [id, entry] of typed) void offerToSave(secrets, id, entry);
    },
  };
}

async function offerToSave(secrets: HostSecretStore, id: number, entry: { alias: string; password?: string; passphrase?: string }) {
  const what = entry.password ? t('password') : t('key passphrase');
  const save = t('Save');
  const choice = await vscode.window.showInformationMessage(t('Save the {0} for "{1}" in the system keychain?', what, entry.alias), save, t('Not now'));
  if (choice !== save) return;
  await secrets.save(id, { password: entry.password, passphrase: entry.passphrase });
  vscode.window.setStatusBarMessage(t('Saved to keychain'), 2000);
}
