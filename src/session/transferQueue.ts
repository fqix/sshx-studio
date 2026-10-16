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
/** Longest a resumed transfer waits for the stopped attempt's requests to drain. */
const SETTLE_WAIT_MS = 5000;

/** What a transfer does once it has its own SFTP channel. */
export interface TransferContext {
  rfs: RemoteFs;
  /** Set total size / file count once known (after scanning folders). */
  setTotals(files: number, bytes: number): void;
  /** Bytes transferred since the last call. */
  progress(bytes: number): void;
  /** Bytes already done by an earlier attempt of a resumed transfer (not counted as speed). */
  skip(bytes: number): void;
  /** A file of a folder transfer started / finished. */
  fileStarted(name: string): void;
  fileDone(): void;
}

interface Job {
  item: TransferItem;
  run(ctx: TransferContext): Promise<void>;
  /**
   * Best-effort removal of partially written files. Runs after a cancel, or a failure of a
   * non-resumable job; a resumable job keeps them until it is cleared from the list.
   */
  cleanup?(): Promise<void>;
  /** `run` can be called again after a failure or pause and continues where it stopped. */
  resumable: boolean;
  paused: boolean;
  /** Stopped because the connection dropped; resumed automatically after reconnecting. */
  interrupted?: boolean;
  /** Counts attempts; callbacks from an earlier attempt (still draining after a stop) are ignored. */
  attempt: number;
  /** The last attempt's work, which a resumed attempt waits for so the two never touch the same files at once. */
  settled?: Promise<unknown>;
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
    options: { revealPath?: string; cleanup?: Job['cleanup']; resumable?: boolean } = {},
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
      canResume: false,
    };
    this.jobs.push({
      item,
      run,
      cleanup: options.cleanup,
      resumable: !!options.resumable,
      revealPath: options.revealPath,
      cancelled: false,
      paused: false,
      attempt: 0,
      samples: [],
    });
    this.flush();
    this.pump();
    return item.id;
  }

  /** Stop and discard: partial files are removed. Also discards a paused or failed transfer. */
  cancel(id: number) {
    const job = this.jobs.find((j) => j.item.id === id);
    if (!job) return;
    if (job.item.canResume) {
      job.item.canResume = false;
      job.item.status = 'cancelled';
      void job.cleanup?.().catch(() => {});
    } else if (job.item.status === 'queued' || job.item.status === 'running') {
      job.cancelled = true;
      job.paused = false;
      if (job.item.status === 'queued') job.item.status = 'cancelled';
      else this.stop(job, new Error('cancelled'));
    }
    this.flush();
    this.pump();
  }

  /** Stop but keep partial files, so the transfer can be resumed. */
  pause(id: number) {
    const job = this.jobs.find((j) => j.item.id === id);
    if (!job?.resumable || (job.item.status !== 'queued' && job.item.status !== 'running')) return;
    job.cancelled = true;
    job.paused = true;
    if (job.item.status === 'queued') {
      job.item.status = 'paused';
      job.item.canResume = true;
    } else {
      this.stop(job, new Error('paused'));
    }
    this.flush();
    this.pump();
  }

  /** Queue a paused or failed transfer again; it continues from where it stopped. */
  resume(id: number) {
    const job = this.jobs.find((j) => j.item.id === id);
    if (!job?.item.canResume) return;
    Object.assign(job.item, { status: 'queued', canResume: false, error: undefined, doneBytes: 0, filesDone: 0, bytesPerSecond: 0, currentFile: undefined });
    job.cancelled = false;
    job.paused = false;
    job.interrupted = false;
    job.samples = [];
    this.flush();
    this.pump();
  }

  /** Reconnected: resume what the lost connection interrupted. */
  resumeInterrupted() {
    for (const job of this.jobs) if (job.interrupted && job.item.canResume) this.resume(job.item.id);
  }

  clearFinished() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i];
      if (['queued', 'running'].includes(job.item.status)) continue;
      // Leaving the list ends any chance to resume, so the partial files go too.
      if (job.item.canResume) void job.cleanup?.().catch(() => {});
      this.jobs.splice(i, 1);
    }
    this.flush();
  }

  revealPath(id: number): string | undefined {
    return this.jobs.find((j) => j.item.id === id)?.revealPath;
  }

  /** Connection lost (`interrupted`) or session closed: fail everything that hasn't finished. */
  abortAll(reason: string, interrupted = false) {
    for (const job of this.jobs) {
      if (job.item.status === 'queued' || job.item.status === 'running') {
        job.cancelled = true;
        job.paused = false;
        job.item.status = 'error';
        job.item.error = reason;
        if (job.resumable) job.item.canResume = true;
        job.interrupted = interrupted && job.resumable;
        this.stop(job, new Error(reason));
      }
    }
    this.flush();
  }

  dispose() {
    this.abortAll(t('Session closed'));
    if (this.updateTimer) clearTimeout(this.updateTimer);
    // Nobody can resume them any more. Local partial files can still go; remote ones only if the channel is still up.
    for (const job of this.jobs) if (job.item.canResume) void job.cleanup?.().catch(() => {});
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
    const attempt = ++job.attempt;
    const current = () => job.attempt === attempt;
    item.status = 'running';
    this.flush();
    const aborted = new Promise<never>((_, reject) => (job.abort = reject));
    aborted.catch(() => {});
    try {
      // A stopped attempt is settled at once but its requests drain for a moment; wait (bounded) for them.
      if (job.settled) await Promise.race([job.settled, aborted, new Promise((r) => setTimeout(r, SETTLE_WAIT_MS))]);
      job.rfs = await Promise.race([this.openChannel(), aborted]);
      if (job.cancelled) throw new Error('cancelled');
      const work = job.run({
        rfs: job.rfs,
        setTotals: (files, bytes) => {
          if (!current()) return;
          item.files = files;
          item.totalBytes = bytes;
          this.scheduleUpdate();
        },
        progress: (bytes) => {
          if (!current()) return;
          item.doneBytes += bytes;
          this.sample(job);
          this.scheduleUpdate();
        },
        skip: (bytes) => {
          if (!current()) return;
          item.doneBytes += bytes;
          job.samples = [];
          this.scheduleUpdate();
        },
        fileStarted: (name) => {
          if (!current()) return;
          item.currentFile = name;
          this.scheduleUpdate();
        },
        fileDone: () => {
          if (!current()) return;
          item.filesDone++;
          this.scheduleUpdate();
        },
      });
      work.catch(() => {});
      job.settled = work.catch(() => {});
      await Promise.race([work, aborted]);
      if (job.cancelled) throw new Error('cancelled');
      item.status = 'done';
      item.currentFile = undefined;
      item.canReveal = item.direction === 'download' && !!job.revealPath;
    } catch (e) {
      // abortAll() may already have marked it as an error while we were awaiting.
      const aborted = (item.status as TransferStatus) === 'error';
      if (job.paused) {
        item.status = 'paused';
      } else if (job.cancelled && !aborted) {
        item.status = 'cancelled';
      } else if (!aborted) {
        item.status = 'error';
        item.error = errorMessage(e);
        this.log(`${item.direction} ${item.name}: ${item.error}`);
      }
      // A resumable job keeps its partial files after a pause or failure; a cancel removes them.
      const keep = job.resumable && item.status !== 'cancelled';
      item.canResume = keep;
      if (!keep) await job.cleanup?.().catch(() => {});
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
