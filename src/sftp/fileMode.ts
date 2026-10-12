import type { FileEntry } from '../../shared/protocol';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

export const isDirMode = (mode: number) => (mode & S_IFMT) === S_IFDIR;

export function entryType(mode: number): FileEntry['type'] {
  const t = mode & S_IFMT;
  return t === S_IFDIR ? 'dir' : t === S_IFLNK ? 'link' : 'file';
}
