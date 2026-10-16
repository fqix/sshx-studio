// TransferQueue against a real SFTP server: parallel limit, per-transfer progress, folders,
// cancellation (with partial-file cleanup), pause / resume, and per-transfer channels.
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Client } from 'ssh2';
import type { TransferItem } from '../shared/protocol';
import { TransferQueue } from '../src/session/transferQueue';
import { TransferService } from '../src/session/transferService';
import { RemoteFs } from '../src/sftp/remoteFs';
import { listLocalDir } from '../src/utils/localDir';
import { downloadResumable, FileResume, PART_SUFFIX, pipelinedCopy } from '../src/sftp/resumable';

let dump = () => '';
const waitFor = async (cond: () => boolean, ms = 20000, what = cond.toString()) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${dump()}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Wires TransferQueue + TransferService the way FileController does, minus the VS Code dialogs. */
export async function transferTests(client: Client, remoteRoot: string) {
  let items: TransferItem[] = [];
  let peakRunning = 0;
  const mainFs = await RemoteFs.open(client);
  const queue = new TransferQueue(
    () => RemoteFs.open(client),
    (next) => {
      items = next;
      peakRunning = Math.max(peakRunning, items.filter((i) => i.status === 'running').length);
    },
    () => {},
  );
  const files = new TransferService(queue, () => mainFs, () => {});
  dump = () => JSON.stringify(items.map(({ name, status, doneBytes, totalBytes, error }) => ({ name, status, doneBytes, totalBytes, error })));

  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'sshx-xfer-'));
  const big = path.join(local, 'big.bin');
  fs.writeFileSync(big, crypto.randomBytes(24 * 1024 * 1024));
  const tree = path.join(local, 'tree');
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(tree, i < 3 ? `f${i}.txt` : `sub/f${i}.txt`), `file ${i}\n`.repeat(1000));
  const small = Array.from({ length: 4 }, (_, i) => {
    const f = path.join(local, `s${i}.bin`);
    fs.writeFileSync(f, crypto.randomBytes(512 * 1024));
    return f;
  });

  // Uploads: 1 big + 1 folder + 4 small = 6 transfers, at most 3 at a time.
  const up = (p: string) => files.uploadPaths([p], '/');
  [big, tree, ...small].forEach(up);
  await waitFor(() => items.length === 6 && items.every((i) => i.status === 'done' || i.status === 'error'));
  assert.ok(items.every((i) => i.status === 'done'), JSON.stringify(items.filter((i) => i.status !== 'done')));
  assert.ok(peakRunning <= 3, `at most 3 in parallel (saw ${peakRunning})`);
  const folder = items.find((i) => i.name === 'tree')!;
  assert.deepStrictEqual([folder.files, folder.filesDone, folder.doneBytes === folder.totalBytes], [5, 5, true]);
  assert.ok(fs.readFileSync(path.join(remoteRoot, 'big.bin')).equals(fs.readFileSync(big)), 'big upload intact');
  assert.strictEqual(fs.readFileSync(path.join(remoteRoot, 'tree/sub/f4.txt'), 'utf8'), fs.readFileSync(path.join(tree, 'sub/f4.txt'), 'utf8'));
  console.log(`ok  transfers: 6 uploads, ≤3 parallel (peak ${peakRunning}), folder 5/5 files`);

  // Cancel an upload mid-way: status cancelled, partial remote file removed, browsing still works.
  queue.clearFinished();
  fs.rmSync(path.join(remoteRoot, 'big.bin'));
  up(big);
  await waitFor(() => (items[0]?.doneBytes ?? 0) > 2 * 1024 * 1024);
  queue.cancel(items[0].id);
  await waitFor(() => items[0].status === 'cancelled');
  await waitFor(() => !fs.existsSync(path.join(remoteRoot, 'big.bin')), 5000);
  assert.ok(items[0].doneBytes < items[0].totalBytes);
  assert.ok((await mainFs.listDir('/')).length > 0, 'main SFTP channel unaffected by closing the transfer channel');
  console.log('ok  cancel upload: stopped mid-way, partial remote file removed, browsing unaffected');

  // Download (file, then cancel one mid-way: partial local file removed).
  queue.clearFinished();
  fs.writeFileSync(path.join(remoteRoot, 'big.bin'), fs.readFileSync(big));
  const dl = path.join(local, 'dl');
  fs.mkdirSync(dl);
  files.downloadTo(['/tree'], dl);
  await waitFor(() => items[0]?.status === 'done');
  assert.strictEqual(fs.readFileSync(path.join(dl, 'tree/sub/f3.txt'), 'utf8'), fs.readFileSync(path.join(tree, 'sub/f3.txt'), 'utf8'));
  assert.ok(items[0].canReveal, 'finished download can be revealed');
  const partial = path.join(dl, 'big.bin');
  files.downloadFile('/big.bin', partial);
  await waitFor(() => (items[1]?.doneBytes ?? 0) > 2 * 1024 * 1024);
  queue.cancel(items[1].id);
  await waitFor(() => items[1].status === 'cancelled');
  await waitFor(() => !fs.existsSync(partial), 5000);
  console.log('ok  download folder + cancel download (partial local file removed)');

  assert.ok(!fs.existsSync(partial + PART_SUFFIX), 'cancel removes the .sshxpart file');

  // Pause an upload, then resume it: the partial file is kept and the result is intact.
  queue.clearFinished();
  fs.rmSync(path.join(remoteRoot, 'big.bin'));
  up(big);
  await waitFor(() => (items[0]?.doneBytes ?? 0) > 4 * 1024 * 1024);
  queue.pause(items[0].id);
  await waitFor(() => items[0].status === 'paused');
  assert.ok(items[0].canResume);
  const remotePart = path.join(remoteRoot, 'big.bin' + PART_SUFFIX);
  assert.ok(fs.existsSync(remotePart) && !fs.existsSync(path.join(remoteRoot, 'big.bin')), 'paused upload keeps only the part file');
  queue.resume(items[0].id);
  await waitFor(() => items[0].status === 'done');
  assert.ok(fs.readFileSync(path.join(remoteRoot, 'big.bin')).equals(fs.readFileSync(big)), 'resumed upload intact');
  assert.ok(!fs.existsSync(remotePart), 'part file renamed into place');
  assert.strictEqual(items[0].doneBytes, items[0].totalBytes);

  // A dropped connection fails the transfer as resumable; reconnecting resumes it automatically.
  queue.clearFinished();
  const dlBig = path.join(dl, 'big-resumed.bin');
  files.downloadFile('/big.bin', dlBig);
  await waitFor(() => (items[0]?.doneBytes ?? 0) > 4 * 1024 * 1024);
  queue.abortAll('Disconnected', true);
  await waitFor(() => items[0].status === 'error');
  assert.ok(items[0].canResume && fs.existsSync(dlBig + PART_SUFFIX), 'interrupted download keeps its part file');
  queue.resumeInterrupted();
  await waitFor(() => items[0].status === 'done');
  assert.ok(fs.readFileSync(dlBig).equals(fs.readFileSync(big)), 'resumed download intact');

  // Clearing a paused transfer from the list removes its part file.
  queue.clearFinished();
  files.downloadFile('/big.bin', path.join(dl, 'abandoned.bin'));
  await waitFor(() => (items[0]?.doneBytes ?? 0) > 1024 * 1024);
  queue.pause(items[0].id);
  await waitFor(() => items[0].status === 'paused');
  queue.clearFinished();
  await waitFor(() => !fs.existsSync(path.join(dl, 'abandoned.bin' + PART_SUFFIX)), 5000);
  console.log('ok  pause / resume upload, auto-resume download after a dropped connection, part files cleaned up');

  // Resuming continues from the written prefix (only the rest is read again), and restarts if the source changed.
  const src = crypto.randomBytes(5 * 1024 * 1024 + 123);
  const dst = Buffer.alloc(src.length);
  const state: FileResume = { offset: 0 };
  let reads = 0;
  const io = (failAfter = Infinity) => ({
    read: async (buf: Buffer, len: number, pos: number) => {
      if (reads++ >= failAfter) throw new Error('link down');
      // Short reads, like some servers return.
      const n = Math.min(len, 10000);
      src.copy(buf, 0, pos, pos + n);
      return n;
    },
    write: async (buf: Buffer, len: number, pos: number) => {
      await new Promise((r) => setTimeout(r, Math.random() * 2)); // complete out of order
      buf.copy(dst, pos, 0, len);
    },
  });
  await assert.rejects(pipelinedCopy(src.length, state, () => {}, io(200)), /link down/);
  assert.ok(state.offset > 0 && state.offset < src.length, `stopped part-way (offset ${state.offset})`);
  assert.ok(dst.subarray(0, state.offset).equals(src.subarray(0, state.offset)), 'everything below the offset is written');
  const resumedAt = state.offset;
  let resent = 0;
  await pipelinedCopy(src.length, state, (n) => (resent += n), io());
  assert.ok(dst.equals(src), 'resumed copy intact');
  assert.strictEqual(resent, src.length - resumedAt, 'only the bytes after the offset are sent again');
  assert.strictEqual(state.offset, src.length);

  fs.writeFileSync(path.join(remoteRoot, 'changing.bin'), crypto.randomBytes(100_000));
  const changing: FileResume = { offset: 50_000, source: { size: 1, mtime: 1 } };
  let skipped = -1;
  await downloadResumable(mainFs, '/changing.bin', path.join(dl, 'changing.bin'), changing, { progress: () => {}, skip: (n) => (skipped = n) });
  assert.strictEqual(skipped, 0, 'changed source restarts from 0');
  assert.ok(fs.readFileSync(path.join(dl, 'changing.bin')).equals(fs.readFileSync(path.join(remoteRoot, 'changing.bin'))));
  console.log('ok  resumable copy: continues from the written prefix, restarts when the source changed');

  // Local pane listing: dirs first, symlinked dirs navigable, dangling links kept as links.
  fs.symlinkSync(tree, path.join(dl, 'tree-link'), process.platform === 'win32' ? 'junction' : 'dir');
  if (process.platform !== 'win32') fs.symlinkSync(path.join(dl, 'missing'), path.join(dl, 'dangling'));
  const listing = await listLocalDir(dl);
  assert.strictEqual(listing.find((e) => e.name === 'tree-link')?.type, 'dir');
  if (process.platform !== 'win32') assert.strictEqual(listing.find((e) => e.name === 'dangling')?.type, 'link');
  const firstFile = listing.findIndex((e) => e.type !== 'dir');
  assert.ok(listing.slice(firstFile).every((e) => e.type !== 'dir'), 'directories first');
  console.log('ok  local pane listing');

  queue.dispose();
  mainFs.end();
  fs.rmSync(local, { recursive: true, force: true });
}
