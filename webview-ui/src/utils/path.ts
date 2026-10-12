/** POSIX path helpers for remote paths. */
export const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? dir : dir + '/') + name;
export const parentPath = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
