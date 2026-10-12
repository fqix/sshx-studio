/** OpenSSH-style host patterns: `*`, `?`, and `!negation`, case-insensitive. */

export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** True if `host` matches at least one positive pattern and no negated one. */
export function matchPatterns(host: string, patterns: string[]): boolean {
  let matched = false;
  for (const p of patterns) {
    if (p.startsWith('!')) {
      if (globToRegex(p.slice(1)).test(host)) return false;
    } else if (globToRegex(p).test(host)) {
      matched = true;
    }
  }
  return matched;
}

export const isConcretePattern = (p: string) => !/[*?!]/.test(p);
