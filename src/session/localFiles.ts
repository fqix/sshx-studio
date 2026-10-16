import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HostMessage } from '../../shared/protocol';
import { t } from '../i18n';
import { errorMessage } from '../utils/async';
import { listLocalDir } from '../utils/localDir';

/** The local pane of a session tab: browsing and simple file operations on this machine. */
export class LocalFiles {
  private currentDir = '';

  constructor(private readonly send: (m: HostMessage) => void) {}

  /** The folder a new pane starts in: the first workspace folder, else the home directory. */
  private defaultDir(): string {
    const ws = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file');
    return ws?.uri.fsPath ?? os.homedir();
  }

  async list(dir: string) {
    const target = path.resolve(dir || this.currentDir || this.defaultDir());
    try {
      const entries = await listLocalDir(target);
      this.currentDir = target;
      this.send({ type: 'local.listing', path: target, parent: path.dirname(target), home: os.homedir(), sep: path.sep, entries });
    } catch (e) {
      this.send({ type: 'local.error', message: `${target}: ${errorMessage(e)}` });
    }
  }

  /** Re-list `dir` if it's the one shown (after a download into it). */
  refresh(dir: string) {
    if (this.currentDir && path.resolve(dir) === this.currentDir) void this.list(dir);
  }

  get shownDir(): string {
    return this.currentDir || this.defaultDir();
  }

  async open(p: string) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
  }

  async reveal(p: string) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
  }

  async mkdir(dir: string) {
    const name = await vscode.window.showInputBox({ prompt: t('New folder in {0}', dir) });
    if (!name) return;
    await fs.promises.mkdir(path.join(dir, name));
    this.refresh(dir);
  }

  async rename(p: string) {
    const old = path.basename(p);
    const name = await vscode.window.showInputBox({ prompt: t('Rename to'), value: old });
    if (!name || name === old) return;
    const to = path.join(path.dirname(p), name);
    if (fs.existsSync(to)) throw new Error(t('"{0}" already exists.', name));
    await fs.promises.rename(p, to);
    this.refresh(path.dirname(p));
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    const what = paths.length === 1 ? path.basename(paths[0]) : t('{0} items', paths.length);
    const del = t('Move to Trash');
    const ok = await vscode.window.showWarningMessage(t('Move {0} to the trash?', what), { modal: true, detail: paths.join('\n') }, del);
    if (ok !== del) return;
    for (const p of paths) await vscode.workspace.fs.delete(vscode.Uri.file(p), { recursive: true, useTrash: true });
    this.refresh(path.dirname(paths[0]));
  }
}
