import * as os from 'os';
import * as path from 'path';
import { isConcretePattern, matchPatterns } from './hostPattern';
import { ConfigBlock, ConfigLine, parseConfigFile } from './parser';
import { OptionSource, resolveOptions } from './resolveOptions';
import type { ResolvedHost } from './types';

/** Options that accumulate across blocks instead of first-value-wins. */
const MULTI_VALUE = new Set(['identityfile', 'certificatefile', 'localforward', 'remoteforward', 'dynamicforward', 'sendenv', 'setenv']);

/** Query interface over a parsed ssh config file. */
export class SshConfig {
  private readonly blocks: ConfigBlock[];

  constructor(configPath: string) {
    this.blocks = parseConfigFile(configPath);
  }

  static defaultPath(): string {
    return path.join(os.homedir(), '.ssh', 'config');
  }

  /** Concrete host aliases (no wildcards / negations), in file order. */
  listHosts(): string[] {
    const seen = new Set<string>();
    for (const b of this.blocks) for (const p of b.patterns ?? []) if (isConcretePattern(p)) seen.add(p);
    return [...seen];
  }

  /** Effective options for `alias` (OpenSSH first-value-wins semantics). */
  options(alias: string): OptionSource {
    const merged = new Map<string, ConfigLine[]>();
    for (const b of this.blocks) {
      if (b.never || (b.patterns && !matchPatterns(alias, b.patterns))) continue;
      for (const o of b.options) {
        if (MULTI_VALUE.has(o.key)) merged.set(o.key, [...(merged.get(o.key) ?? []), o]);
        else if (!merged.has(o.key)) merged.set(o.key, [o]);
      }
    }
    return {
      first: (k) => merged.get(k)?.[0]?.args[0],
      verbatim: (k) => merged.get(k)?.[0]?.value,
      all: (k) => (merged.get(k) ?? []).flatMap((l) => l.args),
    };
  }

  /** Verbatim value of every occurrence of a multi-value keyword (e.g. each LocalForward line). */
  values(alias: string, key: string): string[] {
    const out: string[] = [];
    for (const b of this.blocks) {
      if (b.never || (b.patterns && !matchPatterns(alias, b.patterns))) continue;
      for (const o of b.options) if (o.key === key) out.push(o.value);
    }
    return out;
  }

  /** Every keyword that applies to `alias`, with its verbatim value. */
  optionMap(alias: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const b of this.blocks) {
      if (b.never || (b.patterns && !matchPatterns(alias, b.patterns))) continue;
      for (const o of b.options) if (!(o.key in out)) out[o.key] = o.value;
    }
    return out;
  }

  resolve(alias: string): ResolvedHost {
    return resolveOptions(alias, this.options(alias));
  }
}
