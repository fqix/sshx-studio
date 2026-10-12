import * as fs from 'fs';
import * as path from 'path';
import { posix } from 'path';
import type { RemoteFs } from '../sftp/remoteFs';
import { planDownload, planUpload, totalSize, TransferJob } from '../sftp/transfer';
import type { TransferQueue } from './transferQueue';

/**
 * Turns upload/download requests into TransferQueue jobs: one job (one progress bar) per selected
 * file or folder. Folders are scanned on the job's own channel. No VS Code dependency.
 */
export class TransferService {
  constructor(
    private readonly queue: TransferQueue,
    /** The browsing SFTP channel, used for cleanup after a cancelled upload. */
    private readonly mainFs: () => RemoteFs,
    /** Re-list a remote directory if it is the one shown. */
    private readonly refresh: (dir: string) => void,
  ) {}

  /** Upload local files/folders into `dir`. */
  uploadPaths(localPaths: string[], dir: string) {
    for (const local of localPaths) {
      let partial: string | undefined;
      this.queue.enqueue(
        'upload',
        path.basename(local),
        async (ctx) => {
          const plan = planUpload([local], dir);
          ctx.setTotals(plan.jobs.length, totalSize(plan.jobs));
          for (const d of plan.dirs) await ctx.rfs.mkdir(d);
          for (const job of plan.jobs) {
            ctx.fileStarted(posix.basename(job.remote));
            partial = job.remote;
            await ctx.rfs.upload(job.local, job.remote, ctx.progress);
            partial = undefined;
            ctx.fileDone();
          }
          this.refresh(dir);
        },
        {
          cleanup: async () => {
            if (partial) await this.mainFs().remove(partial);
          },
        },
      );
    }
  }

  /** Upload in-memory content (a file dropped onto the webview). */
  uploadData(dir: string, name: string, data: Uint8Array) {
    const remote = posix.join(dir, name);
    this.queue.enqueue(
      'upload',
      name,
      async (ctx) => {
        ctx.setTotals(1, data.byteLength);
        ctx.fileStarted(name);
        await ctx.rfs.writeFile(remote, data);
        ctx.progress(data.byteLength);
        ctx.fileDone();
        this.refresh(dir);
      },
      { cleanup: () => this.mainFs().remove(remote) },
    );
  }

  /** Download remote files/folders into `targetDir`. */
  downloadTo(remotePaths: string[], targetDir: string) {
    for (const remote of remotePaths) {
      const name = posix.basename(remote);
      this.enqueueDownload(name, path.join(targetDir, name), (rfs) => planDownload(rfs, [remote], targetDir));
    }
  }

  /** Download one remote file to an exact local path. */
  downloadFile(remote: string, localPath: string) {
    this.enqueueDownload(posix.basename(remote), localPath, async (rfs) => [{ remote, local: localPath, size: (await rfs.stat(remote)).size }]);
  }

  private enqueueDownload(name: string, revealPath: string, plan: (rfs: RemoteFs) => Promise<TransferJob[]>) {
    let partial: string | undefined;
    this.queue.enqueue(
      'download',
      name,
      async (ctx) => {
        const jobs = await plan(ctx.rfs);
        ctx.setTotals(jobs.length, totalSize(jobs));
        for (const job of jobs) {
          ctx.fileStarted(path.basename(job.local));
          partial = job.local;
          await ctx.rfs.download(job.remote, job.local, ctx.progress);
          partial = undefined;
          ctx.fileDone();
        }
      },
      {
        revealPath,
        cleanup: async () => {
          if (partial) await fs.promises.rm(partial, { force: true });
        },
      },
    );
  }
}
