import * as fs from 'fs';
import * as path from 'path';
import { posix } from 'path';
import type { RemoteFs } from './remoteFs';

export interface TransferJob {
  local: string;
  remote: string;
  size: number;
}

/** Remote files/dirs → list of file downloads under `targetDir` (local directories are created). */
export async function planDownload(rfs: RemoteFs, remotePaths: string[], targetDir: string): Promise<TransferJob[]> {
  const jobs: TransferJob[] = [];
  const walk = async (remote: string, local: string) => {
    const st = await rfs.stat(remote);
    if (st.isDirectory()) {
      fs.mkdirSync(local, { recursive: true });
      for (const e of await rfs.readdir(remote)) await walk(posix.join(remote, e.name), path.join(local, e.name));
    } else {
      jobs.push({ remote, local, size: st.size });
    }
  };
  for (const p of remotePaths) await walk(p, path.join(targetDir, posix.basename(p)));
  return jobs;
}

/** Local files/dirs → remote directories to create + file uploads under `remoteDir`. */
export function planUpload(localPaths: string[], remoteDir: string): { dirs: string[]; jobs: TransferJob[] } {
  const dirs: string[] = [];
  const jobs: TransferJob[] = [];
  const walk = (local: string, remote: string) => {
    const st = fs.statSync(local);
    if (st.isDirectory()) {
      dirs.push(remote);
      for (const n of fs.readdirSync(local)) walk(path.join(local, n), posix.join(remote, n));
    } else {
      jobs.push({ local, remote, size: st.size });
    }
  };
  for (const l of localPaths) walk(l, posix.join(remoteDir, path.basename(l)));
  return { dirs, jobs };
}

export const totalSize = (jobs: TransferJob[]) => jobs.reduce((sum, j) => sum + j.size, 0);
