import * as fs from 'fs';
import type { ByteProgress, RemoteFs } from './remoteFs';

/** Partial files are written next to the target under this suffix and renamed when complete. */
export const PART_SUFFIX = '.sshxpart';

/** Same request size and pipelining depth as ssh2's fastGet/fastPut. */
const CHUNK = 32 * 1024;
const CONCURRENCY = 64;

/**
 * Where a file transfer stands, kept between attempts so a failed or paused transfer can continue.
 * `offset` only counts bytes known to be written with nothing missing before them: requests run in
 * parallel, so the partial file may hold later chunks too, which are simply written again.
 */
export interface FileResume {
  offset: number;
  /** Size and mtime of the source when the partial file was started; a changed source restarts from 0. */
  source?: { size: number; mtime: number };
}

export interface CopyCallbacks {
  /** Bytes transferred in this attempt. */
  progress: ByteProgress;
  /** Bytes kept from an earlier attempt (counted as done, not as transfer speed). */
  skip(bytes: number): void;
}

/** Download `remote` to `local` via `local.sshxpart`, continuing from `state.offset` when the remote file is unchanged. */
export async function downloadResumable(rfs: RemoteFs, remote: string, local: string, state: FileResume, cb: CopyCallbacks) {
  const st = await rfs.stat(remote);
  const part = local + PART_SUFFIX;
  sameSourceOrRestart(state, st.size, st.mtime);
  // Keep only the verified prefix of an earlier attempt.
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (have < state.offset) state.offset = 0;
  const fd = fs.openSync(part, state.offset ? 'r+' : 'w');
  try {
    if (state.offset) fs.ftruncateSync(fd, state.offset);
    const handle = await rfs.open(remote, 'r');
    try {
      cb.skip(state.offset);
      await pipelinedCopy(st.size, state, cb.progress, {
        read: (buf, len, pos) => rfs.read(handle, buf, 0, len, pos),
        write: (buf, len, pos) => new Promise<void>((res, rej) => fs.write(fd, buf, 0, len, pos, (e) => (e ? rej(e) : res()))),
      });
    } finally {
      await rfs.close(handle).catch(() => {});
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(part, local);
}

/** Upload `local` to `remote` via `remote.sshxpart`, continuing from `state.offset` when the local file is unchanged. */
export async function uploadResumable(rfs: RemoteFs, local: string, remote: string, state: FileResume, cb: CopyCallbacks) {
  const st = fs.statSync(local);
  const part = remote + PART_SUFFIX;
  sameSourceOrRestart(state, st.size, Math.floor(st.mtimeMs));
  if (state.offset) {
    const have = await rfs.stat(part).then((s) => s.size, () => 0);
    if (have < state.offset) state.offset = 0;
  }
  const fd = fs.openSync(local, 'r');
  try {
    const handle = await rfs.open(part, state.offset ? 'r+' : 'w');
    try {
      cb.skip(state.offset);
      await pipelinedCopy(st.size, state, cb.progress, {
        read: (buf, len, pos) => new Promise<number>((res, rej) => fs.read(fd, buf, 0, len, pos, (e, n) => (e ? rej(e) : res(n)))),
        write: (buf, len, pos) => rfs.write(handle, buf, 0, len, pos),
      });
    } finally {
      await rfs.close(handle).catch(() => {});
    }
  } finally {
    fs.closeSync(fd);
  }
  await rfs.renameOver(part, remote);
}

function sameSourceOrRestart(state: FileResume, size: number, mtime: number) {
  if (state.source?.size !== size || state.source.mtime !== mtime) {
    state.source = { size, mtime };
    state.offset = 0;
  }
}

interface Endpoints {
  read(buf: Buffer, len: number, pos: number): Promise<number>;
  write(buf: Buffer, len: number, pos: number): Promise<void>;
}

/** Copy bytes [state.offset, size) with up to CONCURRENCY chunks in flight, advancing state.offset as the written prefix grows. */
export async function pipelinedCopy(size: number, state: FileResume, progress: ByteProgress, io: Endpoints) {
  let next = state.offset;
  let failed = false;
  const finished = new Map<number, number>(); // chunk start → length, for chunks past the prefix

  const complete = (pos: number, len: number) => {
    finished.set(pos, len);
    for (let l = finished.get(state.offset); l !== undefined; l = finished.get(state.offset)) {
      finished.delete(state.offset);
      state.offset += l;
    }
  };

  const worker = async () => {
    const buf = Buffer.allocUnsafe(CHUNK);
    while (!failed && next < size) {
      const pos = next;
      const len = Math.min(CHUNK, size - pos);
      next += len;
      // Reads may return less than asked for.
      for (let got = 0; got < len; ) {
        const n = await io.read(buf.subarray(got), len - got, pos + got);
        if (n === 0) throw new Error('The source file got shorter during the transfer.');
        got += n;
      }
      await io.write(buf, len, pos);
      complete(pos, len);
      progress(len);
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.ceil((size - next) / CHUNK)) }, () =>
    worker().catch((e) => {
      failed = true;
      throw e;
    }),
  );
  // Wait for every in-flight request before the caller closes the file: a write landing on a closed
  // (and possibly reused) descriptor would corrupt another file. ssh2 fails pending requests when its channel closes.
  const results = await Promise.allSettled(workers);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) throw (failure as PromiseRejectedResult).reason;
}
