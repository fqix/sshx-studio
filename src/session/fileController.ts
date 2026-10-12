import * as os from 'os';
import * as path from 'path';
import { posix } from 'path';
import type { Client } from 'ssh2';
import * as vscode from 'vscode';
import type { HostMessage } from '../../shared/protocol';
import { RemoteFs } from '../sftp/remoteFs';
import { errorDetail, errorMessage } from '../utils/async';
import type { Logger } from '../utils/logger';
import { t } from '../i18n';
import { TransferQueue } from './transferQueue';
import { TransferService } from './transferService';

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

/** Handles the file pane: listing, transfers and file operations requested by the webview. */
export class FileController {
  private rfs?: RemoteFs;
  private client?: Client;
  private currentDir = '/';
  /** Settles when SFTP is next attached, or when connecting / attaching fails. */
  private ready = deferred();
  private readonly queue: TransferQueue;
  private readonly transfers: TransferService;

  constructor(
    private readonly alias: string,
    private readonly send: (m: HostMessage) => void,
    private readonly log: Logger,
  ) {
    this.queue = new TransferQueue(
      () => {
        if (!this.client) throw new Error(t('Not connected'));
        return RemoteFs.open(this.client);
      },
      (items) => send({ type: 'transfer.update', items }),
      log,
    );
    this.transfers = new TransferService(this.queue, () => this.fs, (dir) => this.refresh(dir));
  }

  /** The active SFTP session; throws if the connection is gone. */
  get fs(): RemoteFs {
    if (!this.rfs) throw new Error(t('Not connected'));
    return this.rfs;
  }

  async attach(client: Client) {
    this.send({ type: 'fs.loading' });
    this.client = client;
    try {
      this.rfs = await RemoteFs.open(client);
      const home = await this.rfs.realpath('.').catch(() => '/');
      this.log(`sftp opened, home=${home}`);
      this.send({ type: 'fs.home', home });
      await this.list(home);
      this.ready.resolve();
    } catch (e) {
      this.log(`sftp: ${errorDetail(e)}`);
      this.send({ type: 'fs.error', message: t('SFTP unavailable: {0}', errorMessage(e)) });
      this.ready.reject(e);
    }
  }

  detach() {
    this.rfs = undefined;
    this.client = undefined;
    // Waiters keep waiting for the next attach; only a settled promise needs replacing.
    if (this.ready.settled) this.ready = deferred();
    this.queue.abortAll(t('Disconnected'));
  }

  dispose() {
    this.queue.dispose();
  }

  async list(dir: string) {
    const real = await this.fs.realpath(dir);
    try {
      const entries = await this.fs.listDir(real);
      this.currentDir = real;
      this.log(`list ${real}: ${entries.length} entries`);
      this.send({ type: 'fs.listing', path: real, entries });
    } catch (e) {
      this.send({ type: 'fs.error', message: `${real}: ${errorMessage(e)}` });
    }
  }

  /** Re-list `dir` if it's the one currently shown. */
  refresh(dir: string) {
    if (dir === this.currentDir) this.list(dir).catch(() => {});
  }

  async download(paths: string[]) {
    if (!paths.length) return;
    if (paths.length === 1 && !(await this.fs.isDir(paths[0]))) {
      const remote = paths[0];
      const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(DOWNLOADS, posix.basename(remote))) });
      if (uri) this.transfers.downloadFile(remote, uri.fsPath);
      return;
    }
    const pick = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: t('Download here'),
      defaultUri: vscode.Uri.file(DOWNLOADS),
    });
    if (pick?.[0]) this.transfers.downloadTo(paths, pick[0].fsPath);
  }

  async upload(dir: string, folder: boolean) {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: !folder,
      canSelectFolders: folder,
      openLabel: t('Upload to {0}', dir),
    });
    if (picks?.length) this.transfers.uploadPaths(picks.map((u) => u.fsPath), dir);
  }

  /** File dropped from the OS into the webview (content shipped over postMessage). */
  drop(dir: string, name: string, data: Uint8Array) {
    this.transfers.uploadData(dir, name, data);
  }

  /** Resolves once SFTP is usable on this session's connection; rejects if connecting fails. */
  whenReady(): Promise<void> {
    return this.ready.promise;
  }

  /** The SSH connection could not be established: fail anyone waiting for SFTP. */
  connectionFailed(error: unknown) {
    this.ready.reject(error);
    this.ready = deferred();
  }

  /** The remote directory currently shown in the file pane. */
  get shownDir(): string {
    return this.currentDir;
  }

  /** Upload local files/folders (e.g. from VS Code's Explorer) into `dir`. */
  uploadLocal(localPaths: string[], dir: string) {
    this.transfers.uploadPaths(localPaths, dir);
  }

  cancelTransfer(id: number) {
    this.queue.cancel(id);
  }

  clearFinishedTransfers() {
    this.queue.clearFinished();
  }

  revealTransfer(id: number) {
    const target = this.queue.revealPath(id);
    if (target) vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
  }

  async mkdir(dir: string) {
    const name = await vscode.window.showInputBox({ prompt: t('New folder in {0}', dir) });
    if (!name) return;
    await this.fs.mkdir(posix.join(dir, name));
    this.refresh(dir);
  }

  async rename(remote: string) {
    const old = posix.basename(remote);
    const name = await vscode.window.showInputBox({ prompt: t('Rename to'), value: old });
    if (!name || name === old) return;
    await this.fs.rename(remote, posix.join(posix.dirname(remote), name));
    this.refresh(posix.dirname(remote));
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    const what = paths.length === 1 ? posix.basename(paths[0]) : t('{0} items', paths.length);
    const del = t('Delete');
    const ok = await vscode.window.showWarningMessage(
      t('Delete {0} on {1}?', what, this.alias),
      { modal: true, detail: `${paths.join('\n')}\n\n${t('This cannot be undone.')}` },
      del,
    );
    if (ok !== del) return;
    for (const p of paths) await this.fs.remove(p);
    this.refresh(posix.dirname(paths[0]));
  }

}

function deferred() {
  const d = { settled: false } as { settled: boolean; promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
  d.promise = new Promise<void>((res, rej) => {
    d.resolve = () => ((d.settled = true), res());
    d.reject = (e) => ((d.settled = true), rej(e));
  });
  d.promise.catch(() => {}); // a failure is reported in the file pane; waiters handle it themselves
  return d;
}
