import * as fs from 'fs';
import * as path from 'path';
import type { FileEntry } from '../../shared/protocol';

/** Directory listing for the local pane: symlinks to directories are navigable, dirs first, sorted by name. */
export async function listLocalDir(dir: string): Promise<FileEntry[]> {
  const names = await fs.promises.readdir(dir);
  const entries = await Promise.all(
    names.map(async (name): Promise<FileEntry | undefined> => {
      const full = path.join(dir, name);
      try {
        const l = await fs.promises.lstat(full);
        // Follow links for the type and size; a dangling link stays a link.
        const st = l.isSymbolicLink() ? await fs.promises.stat(full).catch(() => l) : l;
        return {
          name,
          type: st.isDirectory() ? 'dir' : l.isSymbolicLink() && st === l ? 'link' : 'file',
          size: st.size,
          mtime: Math.floor(st.mtimeMs / 1000),
          mode: st.mode,
        };
      } catch {
        return undefined; // vanished or unreadable
      }
    }),
  );
  return entries
    .filter((e): e is FileEntry => !!e)
    .sort((a, b) => ((a.type === 'dir') !== (b.type === 'dir') ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
}
