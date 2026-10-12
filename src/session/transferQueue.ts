import type { TransferDirection, TransferItem, TransferStatus } from '../../shared/protocol';
import { t } from '../i18n';
import type { RemoteFs } from '../sftp/remoteFs';
import { errorMessage, safe } from '../utils/async';

/** Transfers running at the same time; the rest wait in the queue. */
const MAX_PARALLEL = 3;
/** Minimum interval between progress messages to the webview. */
const UPDATE_INTERVAL_MS = 150;
/** Window for the speed estimate. */
const SPEED_WINDOW_MS = 3000;

/** What a transfer does once it has its own SFTP channel. */
export interface TransferContext {
  rfs: RemoteFs;
  /** Set total size / file count once known (after scanning folders). */
  setTotals(files: number, bytes: number): void;
  /** Bytes transferred since the last call. */
  progress(bytes: number): void;
  /** A file of a folder transfer started / finished. */
  fileStarted(name: string): void;
  fileDone(): void;
}

interface Job {
  item: TransferItem;
  run(ctx: TransferContext): Promise<void>;
  /** Best-effort cleanup of a partially written file after cancel/failure. */
  cleanup?(): Promise<void>;
  rfs?: RemoteFs;
  /** Rejects the running job immediately (ssh2's fastGet/fastPut never call back once their channel is closed). */
  abort?: (reason: Error) => void;
  cancelled: boolean;
  samples: [number, number][];
  revealPath?: string;
}

/**
 * Upload/download queue for one session. Each transfer gets a dedicated SFTP channel, so it
 * doesn't block browsing, runs in parallel with others, and is cancelled by closing that channel.
 */
export class TransferQueue {
  private readonly jobs: Job[] = [];
  private nextId = 1;
  private updateTimer?: NodeJS.Timeout;

  constructor(
    /** Opens a new SFTP channel on the session's connection. */
    private readonly openChannel: () => Promise<RemoteFs>,
    private readonly sendItems: (items: TransferItem[]) => void,
    private readonly log: (message: string) => void,
  ) {}

  enqueue(
    direction: TransferDirection,
    name: string,
    run: Job['run'],
    options: { revealPath?: string; cleanup?: Job['cleanup'] } = {},
  ): number {
    const item: TransferItem = {
      id: this.nextId++,
      direction,
      name,
      files: 0,
      filesDone: 0,
      totalBytes: 0,
      doneBytes: 0,
      bytesPerSecond: 0,
      status: 'queued',
      canReveal: false,
    };
    this.jobs.push({ item, run, cleanup: options.cleanup, revealPath: options.revealPath, cancelled: false, samples: [] });
    this.flush();
    this.pump();
    return item.id;
  }

  cancel(id: number) {
    const job = this.jobs.find((j) => j.item.id === id);
    if (!job || (job.item.status !== 'queued' && job.item.status !== 'running')) return;
    job.cancelled = true;
    if (job.item.status === 'queued') job.item.status = 'cancelled';
    else this.stop(job, new Error('cancelled'));
    this.flush();
    this.pump();
  }

  clearFinished() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (!['queued', 'running'].includes(this.jobs[i].item.status)) this.jobs.splice(i, 1);
    }
    this.flush();
  }

  revealPath(id: number): string | undefined {
    return this.jobs.find((j) => j.item.id === id)?.revealPath;
  }

  /** Connection lost: fail everything that hasn't finished. */
  abortAll(reason: string) {
    for (const job of this.jobs) {
      if (job.item.status === 'queued' || job.item.status === 'running') {
        job.cancelled = true;
        job.item.status = 'error';
        job.item.error = reason;
        this.stop(job, new Error(reason));
      }
    }
    this.flush();
  }

  dispose() {
    this.abortAll(t('Session closed'));
    if (this.updateTimer) clearTimeout(this.updateTimer);
  }

  /** Settle a running job now and close its channel to stop the data flow. */
  private stop(job: Job, reason: Error) {
    job.abort?.(reason);
    if (job.rfs) safe(() => job.rfs!.end());
  }

  private pump() {
    const running = this.jobs.filter((j) => j.item.status === 'running').length;
    const next = this.jobs.filter((j) => j.item.status === 'queued').slice(0, Math.max(0, MAX_PARALLEL - running));
    for (const job of next) void this.start(job);
  }

  private async start(job: Job) {
    const item = job.item;
    item.status = 'running';
    this.flush();
    const aborted = new Promise<never>((_, reject) => (job.abort = reject));
    aborted.catch(() => {});
    try {
      job.rfs = await Promise.race([this.openChannel(), aborted]);
      if (job.cancelled) throw new Error('cancelled');
      const work = job.run({
        rfs: job.rfs,
        setTotals: (files, bytes) => {
          item.files = files;
          item.totalBytes = bytes;
          this.scheduleUpdate();
        },
        progress: (bytes) => {
          item.doneBytes += bytes;
          this.sample(job);
          this.scheduleUpdate();
        },
        fileStarted: (name) => {
          item.currentFile = name;
          this.scheduleUpdate();
        },
        fileDone: () => {
          item.filesDone++;
          this.scheduleUpdate();
        },
      });
      work.catch(() => {});
      await Promise.race([work, aborted]);
      if (job.cancelled) throw new Error('cancelled');
      item.status = 'done';
      item.currentFile = undefined;
      item.canReveal = item.direction === 'download' && !!job.revealPath;
    } catch (e) {
      // abortAll() may already have marked it as an error while we were awaiting.
      const aborted = (item.status as TransferStatus) === 'error';
      if (job.cancelled && !aborted) {
        item.status = 'cancelled';
      } else if (!aborted) {
        item.status = 'error';
        item.error = errorMessage(e);
        this.log(`${item.direction} ${item.name}: ${item.error}`);
      }
      await job.cleanup?.().catch(() => {});
    } finally {
      item.bytesPerSecond = 0;
      if (job.rfs) safe(() => job.rfs!.end());
      job.rfs = undefined;
      job.abort = undefined;
      this.flush();
      this.pump();
    }
  }

  /** Bytes/second over the last few seconds. */
  private sample(job: Job) {
    const now = Date.now();
    job.samples.push([now, job.item.doneBytes]);
    while (job.samples.length > 2 && now - job.samples[0][0] > SPEED_WINDOW_MS) job.samples.shift();
    const [t0, b0] = job.samples[0];
    job.item.bytesPerSecond = now > t0 ? ((job.item.doneBytes - b0) * 1000) / (now - t0) : 0;
  }

  private scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => this.flush(), UPDATE_INTERVAL_MS);
  }

  private flush() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    this.sendItems(this.jobs.map((j) => ({ ...j.item })));
  }
}
