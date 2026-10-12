import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { posix } from 'path';
import * as vscode from 'vscode';
import type { RemoteFs } from '../sftp/remoteFs';
import { withByteProgress } from '../utils/progress';
import { t } from '../i18n';

/**
 * Opens remote files in a VS Code editor via a local temp copy, and uploads the copy back on save.
 * Temp layout mirrors the remote path: <tmp>/sshx-studio/<alias>/<remote path>.
 */
export class RemoteEditor implements vscode.Disposable {
  private readonly tmpRoot: string;
  private readonly saveListener: vscode.Disposable;

  constructor(
    private readonly alias: string,
    private readonly getFs: () => RemoteFs,
    /** Called with the remote directory after a save was uploaded. */
    private readonly onUploaded: (remoteDir: string) => void,
  ) {
    this.tmpRoot = path.join(os.tmpdir(), 'sshx-studio', alias.replace(/[^\w.-]/g, '_'));
    this.saveListener = vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc.uri.fsPath));
  }

  async open(remote: string) {
    const local = this.localPathFor(remote);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    await withByteProgress(t('Opening {0}', posix.basename(remote)), (p) => this.getFs().download(remote, local, p.report));
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(local));
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }

  private async onSave(local: string) {
    const remote = this.remotePathFor(local);
    if (!remote) return;
    try {
      await withByteProgress(t('Uploading {0}', posix.basename(remote)), (p) => this.getFs().upload(local, remote, p.report));
      vscode.window.setStatusBarMessage(`$(cloud-upload) ${t('Saved {0} to {1}', remote, this.alias)}`, 3000);
      this.onUploaded(posix.dirname(remote));
    } catch (e) {
      vscode.window.showErrorMessage(t('{0}: could not save {1}: {2}', this.alias, remote, e instanceof Error ? e.message : String(e)));
    }
  }

  private localPathFor(remote: string): string {
    return path.join(this.tmpRoot, ...remote.split('/').filter(Boolean));
  }

  /** Inverse of localPathFor; undefined if `local` isn't one of our temp copies. */
  private remotePathFor(local: string): string | undefined {
    if (!local.startsWith(this.tmpRoot + path.sep)) return undefined;
    return '/' + path.relative(this.tmpRoot, local).split(path.sep).join('/');
  }

  dispose() {
    this.saveListener.dispose();
  }
}
