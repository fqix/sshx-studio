import * as fs from 'fs';
import * as path from 'path';
import { posix } from 'path';
import type { RemoteFs } from '../sftp/remoteFs';
import { downloadResumable, FileResume, PART_SUFFIX, uploadResumable } from '../sftp/resumable';
import { planDownload, planUpload, totalSize, TransferJob } from '../sftp/transfer';
import type { TransferContext, TransferQueue } from './transferQueue';

/** One file of a transfer, remembered across attempts so a resumed transfer skips what is done. */
interface FileTask {
  job: TransferJob;
  resume: FileResume;
  done: boolean;
}

/**
 * Turns upload/download requests into TransferQueue jobs: one job (one progress bar) per selected
 * file or folder. Folders are scanned on the job's own channel. Files are written as `*.sshxpart`
 * and renamed when complete, so a paused or failed transfer can resume. No VS Code dependency.
 */
export class TransferService {
  constructor(
    private readonly queue: TransferQueue,
    /** The browsing SFTP channel, used for cleanup after a cancelled upload. */
    private readonly mainFs: () => RemoteFs,
    /** Re-list a remote directory if it is the one shown. */
    private readonly refresh: (dir: string) => void,
    /** Re-list a local directory if it is the one shown (after a download into it). */
    private readonly refreshLocal?: (dir: string) => void,
  ) {}

  /** Upload local files/folders into `dir`. */
  uploadPaths(localPaths: string[], dir: string) {
    for (const local of localPaths) {
      // Planned on the first attempt and kept, so a resumed folder upload continues with the same files.
      let plan: { dirs: string[]; tasks: FileTask[] } | undefined;
      this.queue.enqueue(
        'upload',
        path.basename(local),
        async (ctx) => {
          if (!plan) {
            const p = planUpload([local], dir);
            plan = { dirs: p.dirs, tasks: p.jobs.map((job) => ({ job, resume: { offset: 0 }, done: false })) };
          }
          for (const d of plan.dirs) await ctx.rfs.mkdir(d);
          await runTasks(ctx, plan.tasks, (t) => posix.basename(t.job.remote), (t, cb) => uploadResumable(ctx.rfs, t.job.local, t.job.remote, t.resume, cb));
          this.refresh(dir);
        },
        {
          resumable: true,
          cleanup: async () => {
            for (const t of plan?.tasks ?? []) if (!t.done && t.resume.source) await this.mainFs().remove(t.job.remote + PART_SUFFIX).catch(() => {});
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
    let tasks: FileTask[] | undefined;
    this.queue.enqueue(
      'download',
      name,
      async (ctx) => {
        tasks ??= (await plan(ctx.rfs)).map((job) => ({ job, resume: { offset: 0 }, done: false }));
        await runTasks(ctx, tasks, (t) => path.basename(t.job.local), (t, cb) => downloadResumable(ctx.rfs, t.job.remote, t.job.local, t.resume, cb));
        this.refreshLocal?.(path.dirname(revealPath));
      },
      {
        revealPath,
        resumable: true,
        cleanup: async () => {
          for (const t of tasks ?? []) if (!t.done) await fs.promises.rm(t.job.local + PART_SUFFIX, { force: true });
        },
      },
    );
  }
}

/** Transfer the files that aren't done yet; finished ones (from an earlier attempt) count as done right away. */
async function runTasks(
  ctx: TransferContext,
  tasks: FileTask[],
  label: (t: FileTask) => string,
  transfer: (t: FileTask, cb: { progress(n: number): void; skip(n: number): void }) => Promise<void>,
) {
  ctx.setTotals(tasks.length, totalSize(tasks.map((t) => t.job)));
  for (const t of tasks) {
    if (t.done) {
      ctx.skip(t.job.size);
      ctx.fileDone();
      continue;
    }
    ctx.fileStarted(label(t));
    await transfer(t, { progress: ctx.progress, skip: ctx.skip });
    t.done = true;
    ctx.fileDone();
  }
}
