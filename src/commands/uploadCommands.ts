import * as vscode from 'vscode';
import { t } from '../i18n';
import { errorMessage } from '../utils/async';
import type { CommandContext } from './context';

/** Explorer → "Upload to SSH Host…": files and folders from this machine into a host's session. */
export function registerUploadCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('sshxStudio.uploadFromExplorer', async (clicked?: vscode.Uri, selected?: vscode.Uri[]) => {
      const uris = await localSources(clicked, selected);
      if (!uris?.length) return;

      const hosts = await ctx.hosts.list();
      if (!hosts.length) return vscode.window.showInformationMessage(t('No hosts yet. Add one in the SSHX Studio view first.'));
      const picked = await vscode.window.showQuickPick(
        hosts.map((h) => ({
          label: h.alias,
          description: `${h.username ? h.username + '@' : ''}${h.hostname}`,
          detail: ctx.sessions.isOpen(h.alias) ? t('$(terminal) Session open') : undefined,
          alias: h.alias,
        })),
        { title: t('Upload {0} to…', describe(uris)), placeHolder: t('Select a host') },
      );
      if (!picked) return;

      // Reuse the host's open session (its transfer list shows the progress), or open one.
      const session = ctx.sessions.findOrOpen(picked.alias);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: t('Connecting to {0}…', picked.alias) },
          () => session.whenFilesReady(),
        );
      } catch (e) {
        return vscode.window.showErrorMessage(t('Cannot upload to {0}: {1}', picked.alias, errorMessage(e)));
      }

      const dir = await vscode.window.showInputBox({
        title: t('Upload {0} to {1}', describe(uris), picked.alias),
        prompt: t('Remote folder'),
        value: session.remoteDir,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().startsWith('/') ? undefined : t('Enter an absolute path, e.g. /home/user')),
      });
      if (!dir) return;
      session.uploadLocal(
        uris.map((u) => u.fsPath),
        dir.trim(),
      );
      session.reveal();
    }),
  ];
}

/**
 * Explorer passes the clicked item and the whole selection; from the command palette
 * there is neither, so ask. Only files on this machine can be uploaded.
 */
async function localSources(clicked?: vscode.Uri, selected?: vscode.Uri[]): Promise<vscode.Uri[] | undefined> {
  let uris = selected?.length ? selected : clicked ? [clicked] : undefined;
  if (!uris) {
    uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: true, openLabel: t('Upload') });
    if (!uris) return undefined;
  }
  const local = uris.filter((u) => u.scheme === 'file');
  if (local.length < uris.length) {
    vscode.window.showWarningMessage(t('Only files on this machine can be uploaded ({0} skipped).', uris.length - local.length));
  }
  return local;
}

const describe = (uris: vscode.Uri[]) => (uris.length === 1 ? uris[0].path.split('/').pop() ?? '' : t('{0} items', uris.length));
