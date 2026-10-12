import { posix } from 'path';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { FileEntry } from '../../shared/protocol';
import { withTimeout } from '../utils/async';
import { entryType, isDirMode } from './fileMode';
import { t } from '../i18n';

const OPEN_TIMEOUT_MS = 15000;
/** SFTP status FAILURE; mkdir returns it when the directory already exists. */
const SFTP_FAILURE = 4;

/** Called with the number of bytes transferred since the previous call. */
export type ByteProgress = (bytes: number) => void;

/** Promise-based wrapper over an ssh2 SFTP session. */
export class RemoteFs {
  private constructor(private readonly sftp: SFTPWrapper) {}

  static async open(client: Client): Promise<RemoteFs> {
    const sftp = await withTimeout(
      new Promise<SFTPWrapper>((res, rej) => client.sftp((e, s) => (e ? rej(e) : res(s)))),
      OPEN_TIMEOUT_MS,
      t('SFTP subsystem did not respond (is sftp-server enabled on the host?)'),
    );
    return new RemoteFs(sftp);
  }

  realpath(p: string): Promise<string> {
    return call<string>((cb) => this.sftp.realpath(p, cb));
  }

  stat(p: string): Promise<Stats> {
    return call<Stats>((cb) => this.sftp.stat(p, cb));
  }

  lstat(p: string): Promise<Stats> {
    return call<Stats>((cb) => this.sftp.lstat(p, cb));
  }

  async isDir(p: string): Promise<boolean> {
    return isDirMode((await this.stat(p)).mode);
  }

  async readdir(dir: string): Promise<FileEntry[]> {
    const list = await call<{ filename: string; attrs: Stats }[]>((cb) => this.sftp.readdir(dir, cb));
    return list.map((f) => ({
      name: f.filename,
      type: entryType(f.attrs.mode),
      size: f.attrs.size,
      mtime: f.attrs.mtime,
      mode: f.attrs.mode,
    }));
  }

  /** Directory listing for display: symlinks to directories become navigable, dirs first, sorted by name. */
  async listDir(dir: string): Promise<FileEntry[]> {
    const entries = await this.readdir(dir);
    await Promise.all(
      entries
        .filter((e) => e.type === 'link')
        .map(async (e) => {
          if (await this.isDir(posix.join(dir, e.name)).catch(() => false)) e.type = 'dir';
        }),
    );
    return entries.sort((a, b) =>
      (a.type === 'dir') !== (b.type === 'dir') ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  /** mkdir that tolerates an existing directory. */
  mkdir(p: string): Promise<void> {
    return new Promise((res, rej) =>
      this.sftp.mkdir(p, (e) => (e && (e as Error & { code?: number }).code !== SFTP_FAILURE ? rej(e) : res())),
    );
  }

  rename(from: string, to: string): Promise<void> {
    return call<void>((cb) => this.sftp.rename(from, to, cb));
  }

  /** Delete a file or a directory tree (symlinks are removed, not followed). */
  async remove(p: string): Promise<void> {
    if (isDirMode((await this.lstat(p)).mode)) {
      for (const e of await this.readdir(p)) await this.remove(posix.join(p, e.name));
      await call<void>((cb) => this.sftp.rmdir(p, cb));
    } else {
      await call<void>((cb) => this.sftp.unlink(p, cb));
    }
  }

  writeFile(p: string, data: Uint8Array): Promise<void> {
    return call<void>((cb) => this.sftp.writeFile(p, Buffer.from(data), cb));
  }

  download(remote: string, local: string, progress: ByteProgress): Promise<void> {
    return call<void>((cb) => this.sftp.fastGet(remote, local, { step: deltaStep(progress) }, cb));
  }

  upload(local: string, remote: string, progress: ByteProgress): Promise<void> {
    return call<void>((cb) => this.sftp.fastPut(local, remote, { step: deltaStep(progress) }, cb));
  }

  end() {
    this.sftp.end();
  }
}

/** Adapt a node-style callback API to a promise. */
function call<T>(fn: (cb: (err: Error | null | undefined, value?: any) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value as T))));
}

/** ssh2 reports cumulative bytes; convert to per-chunk deltas. */
function deltaStep(progress: ByteProgress) {
  let last = 0;
  return (total: number) => {
    progress(total - last);
    last = total;
  };
}
