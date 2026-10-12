// TransferQueue against a real SFTP server: parallel limit, per-transfer progress, folders,
// cancellation (with partial-file cleanup) and per-transfer channels.
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

  queue.dispose();
  mainFs.end();
  fs.rmSync(local, { recursive: true, force: true });
}
