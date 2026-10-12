import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globToRegex } from './hostPattern';
import { expandHome } from './tokens';

/**
 * Parses an OpenSSH client config into blocks.
 * Supports `Include` (with `*` globs, depth-limited), `Host`, and `Match all`;
 * other `Match` criteria are unsupported and their blocks never apply.
 */

export interface ConfigLine {
  /** Keyword, lowercase. */
  key: string;
  /** Whitespace-split arguments with quotes removed. */
  args: string[];
  /** Everything after the keyword, verbatim (needed for ProxyCommand). */
  value: string;
}

export interface ConfigBlock {
  /** `null` for the global section before the first Host/Match. */
  patterns: string[] | null;
  /** Unsupported `Match` block. */
  never?: boolean;
  options: ConfigLine[];
}

const MAX_INCLUDE_DEPTH = 16;

export function parseConfigFile(file: string): ConfigBlock[] {
  const lines: ConfigLine[] = [];
  readInto(file, lines, 0);
  return toBlocks(lines);
}

export function parseLine(raw: string): ConfigLine | null {
  const s = raw.trim();
  if (!s || s.startsWith('#')) return null;
  const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(s);
  if (!m) return null;
  return { key: m[1].toLowerCase(), args: splitArgs(m[2]), value: m[2] };
}

function readInto(file: string, out: ConfigLine[], depth: number) {
  if (depth > MAX_INCLUDE_DEPTH) return;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.key === 'include') {
      for (const pattern of line.args) {
        for (const f of expandInclude(pattern)) readInto(f, out, depth + 1);
      }
    } else {
      out.push(line);
    }
  }
}

function toBlocks(lines: ConfigLine[]): ConfigBlock[] {
  let current: ConfigBlock = { patterns: null, options: [] };
  const blocks = [current];
  for (const l of lines) {
    if (l.key === 'host') {
      current = { patterns: l.args, options: [] };
      blocks.push(current);
    } else if (l.key === 'match') {
      const all = l.args.length === 1 && l.args[0].toLowerCase() === 'all';
      current = { patterns: null, never: !all, options: [] };
      blocks.push(current);
    } else {
      current.options.push(l);
    }
  }
  return blocks;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
  return out;
}

/** Relative Include paths are resolved against ~/.ssh; globs are supported in the last segment. */
function expandInclude(pattern: string): string[] {
  let p = expandHome(pattern);
  if (!path.isAbsolute(p)) p = path.join(os.homedir(), '.ssh', p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (!/[*?]/.test(base)) return [p];
  try {
    const re = globToRegex(base);
    return fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
