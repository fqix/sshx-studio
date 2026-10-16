import * as vscode from 'vscode';
import { HostEditorPanel } from '../hosts/hostEditorPanel';
import { t } from '../i18n';
import { importSshConfig } from '../storage/sshConfigImporter';
import { sshConfigPath } from '../storage/databasePath';
import { GroupItem } from '../views/hostTree/groupItem';
import type { HostItem } from '../views/hostTree/hostItem';
import type { CommandContext } from './context';

export function registerHostCommands(ctx: CommandContext): vscode.Disposable[] {
  const { hosts, forwards, hostService, forwardManager, sessions } = ctx;
  const editorDeps = { service: hostService, resolver: ctx.resolver, newPromptSession: ctx.newPromptSession };

  /** From the tree (HostItem) or the command palette (pick a host). */
  const pickHost = async (item?: HostItem) => {
    if (item) return item.record;
    const all = await hosts.list();
    const picked = await vscode.window.showQuickPick(
      all.map((h) => ({ label: h.alias, description: `${h.username ? h.username + '@' : ''}${h.hostname}`, record: h })),
      { placeHolder: t('Select a host') },
    );
    return picked?.record;
  };

  return [
    vscode.commands.registerCommand('sshxStudio.connect', async (item?: HostItem) => {
      const host = await pickHost(item);
      if (host) sessions.open(host.alias);
    }),

    // From a group's context menu the new host starts in that group.
    vscode.commands.registerCommand('sshxStudio.addHost', (item?: GroupItem) =>
      HostEditorPanel.show(ctx.extensionUri, editorDeps, undefined, undefined, item instanceof GroupItem ? item.group.id : undefined),
    ),

    vscode.commands.registerCommand('sshxStudio.editHost', async (item?: HostItem) => {
      const host = await pickHost(item);
      if (host) HostEditorPanel.show(ctx.extensionUri, editorDeps, host.id, t('Edit {0}', host.alias));
    }),

    vscode.commands.registerCommand('sshxStudio.deleteHost', async (item?: HostItem) => {
      const host = await pickHost(item);
      if (!host) return;
      const del = t('Delete');
      const choice = await vscode.window.showWarningMessage(
        t('Delete host "{0}"?', host.alias),
        { modal: true, detail: t('Its port forwards and saved credentials will be removed too.') },
        del,
      );
      if (choice !== del) return;
      await Promise.all((await forwards.listForHost(host.id)).map((f) => forwardManager.stop(f.id)));
      await hostService.delete(host.id);
    }),

    vscode.commands.registerCommand('sshxStudio.copyPublicKey', async (item?: HostItem) => {
      const host = await pickHost(item);
      const key = host && (await hostService.publicKey(host.id));
      if (!key) return vscode.window.showWarningMessage(t('This host has no stored key.'));
      await vscode.env.clipboard.writeText(key);
      vscode.window.showInformationMessage(t('Public key copied. Append it to ~/.ssh/authorized_keys on the server.'));
    }),

    vscode.commands.registerCommand('sshxStudio.importSshConfig', async () => {
      const file = sshConfigPath();
      const { imported, skipped } = await importSshConfig(hosts, file);
      vscode.window.showInformationMessage(t('Imported {0} host(s) from {1}; {2} already existed.', imported, file, skipped));
    }),
  ];
}
