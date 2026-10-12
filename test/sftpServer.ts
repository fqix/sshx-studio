// Minimal SFTP server for tests, backed by a local directory. READ/WRITE requests are served one
// at a time with a small delay (~8 MB/s with 32 KB chunks) so transfers can be cancelled mid-way.
import * as fs from 'fs';
import * as path from 'path';
import { utils } from 'ssh2';

const { OPEN_MODE, STATUS_CODE } = utils.sftp;
const DELAY_MS = 4;

type Handle = { fd?: number; dir?: string[]; path: string };

export function serveSftp(sftp: any, root: string) {
  const handles = new Map<number, Handle>();
  let next = 0;
  const local = (p: string) => path.join(root, path.posix.normalize('/' + p));
  const handle = (h: Handle) => {
    const id = next++;
    handles.set(id, h);
    const b = Buffer.alloc(4);
    b.writeUInt32BE(id);
    return b;
  };
  const get = (b: Buffer) => handles.get(b.readUInt32BE(0));
  const attrs = (st: fs.Stats) => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: st.atimeMs / 1000, mtime: st.mtimeMs / 1000 });
  const fail = (reqid: number, e: NodeJS.ErrnoException) =>
    sftp.status(reqid, e.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : e.code === 'EACCES' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE, e.message);
  let chain = Promise.resolve();
  const later = (fn: () => void) => {
    chain = chain.then(() => new Promise<void>((r) => setTimeout(() => (fn(), r()), DELAY_MS)));
  };

  sftp.on('REALPATH', (reqid: number, p: string) => {
    const resolved = path.posix.normalize('/' + (p === '.' ? '' : p));
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} }]);
  });
  for (const op of ['STAT', 'LSTAT'] as const) {
    sftp.on(op, (reqid: number, p: string) => {
      try {
        sftp.attrs(reqid, attrs(op === 'STAT' ? fs.statSync(local(p)) : fs.lstatSync(local(p))));
      } catch (e: any) {
        fail(reqid, e);
      }
    });
  }
  sftp.on('FSTAT', (reqid: number, h: Buffer) => {
    const x = get(h);
    if (!x?.fd && x?.fd !== 0) return sftp.status(reqid, STATUS_CODE.FAILURE);
    sftp.attrs(reqid, attrs(fs.fstatSync(x.fd)));
  });
  sftp.on('OPEN', (reqid: number, p: string, flags: number) => {
    try {
      const mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.TRUNC || flags & OPEN_MODE.CREAT ? 'w' : 'r+') : 'r';
      sftp.handle(reqid, handle({ fd: fs.openSync(local(p), mode), path: p }));
    } catch (e: any) {
      fail(reqid, e);
    }
  });
  sftp.on('WRITE', (reqid: number, h: Buffer, offset: number, data: Buffer) =>
    later(() => {
      const x = get(h);
      if (!x || x.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      fs.writeSync(x.fd, data, 0, data.length, offset);
      sftp.status(reqid, STATUS_CODE.OK);
    }),
  );
  sftp.on('READ', (reqid: number, h: Buffer, offset: number, length: number) =>
    later(() => {
      const x = get(h);
      if (!x || x.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      const buf = Buffer.alloc(length);
      const n = fs.readSync(x.fd, buf, 0, length, offset);
      n ? sftp.data(reqid, buf.subarray(0, n)) : sftp.status(reqid, STATUS_CODE.EOF);
    }),
  );
  sftp.on('CLOSE', (reqid: number, h: Buffer) => {
    const x = get(h);
    if (x?.fd !== undefined) fs.closeSync(x.fd);
    handles.delete(h.readUInt32BE(0));
    sftp.status(reqid, STATUS_CODE.OK);
  });
  sftp.on('OPENDIR', (reqid: number, p: string) => {
    try {
      sftp.handle(reqid, handle({ dir: fs.readdirSync(local(p)), path: p }));
    } catch (e: any) {
      fail(reqid, e);
    }
  });
  sftp.on('READDIR', (reqid: number, h: Buffer) => {
    const x = get(h);
    if (!x?.dir?.length) return sftp.status(reqid, STATUS_CODE.EOF);
    const names = x.dir.splice(0).map((filename) => {
      const st = fs.lstatSync(path.join(local(x.path), filename));
      return { filename, longname: filename, attrs: attrs(st) };
    });
    sftp.name(reqid, names);
  });
  sftp.on('MKDIR', (reqid: number, p: string) => {
    try {
      fs.mkdirSync(local(p));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (e: any) {
      fail(reqid, e);
    }
  });
  for (const [op, fn] of [
    ['REMOVE', fs.unlinkSync],
    ['RMDIR', fs.rmdirSync],
  ] as const) {
    sftp.on(op, (reqid: number, p: string) => {
      try {
        fn(local(p));
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (e: any) {
        fail(reqid, e);
      }
    });
  }
  sftp.on('RENAME', (reqid: number, from: string, to: string) => {
    try {
      fs.renameSync(local(from), local(to));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (e: any) {
      fail(reqid, e);
    }
  });
}
