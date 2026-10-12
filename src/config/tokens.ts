import * as os from 'os';
import * as path from 'path';

export function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Expand ssh_config `%x` tokens. Unknown tokens are left as-is. */
export function expandTokens(s: string, vars: Record<string, string>): string {
  const all: Record<string, string> = { ...vars, d: os.homedir(), u: os.userInfo().username, '%': '%' };
  return s.replace(/%(.)/g, (m, c: string) => all[c] ?? m);
}
