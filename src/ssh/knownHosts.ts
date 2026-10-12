import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { globToRegex } from '../config/hostPattern';
import type { ResolvedHost } from '../config/types';
import type { Prompter } from './types';
import { t } from '../i18n';

/** Check a server's host key against known_hosts, honoring StrictHostKeyChecking. */
export async function verifyHostKey(host: ResolvedHost, key: Buffer, prompter: Prompter): Promise<boolean> {
  const name = knownHostsName(host);
  const keyB64 = key.toString('base64');
  const keyType = key.subarray(4, 4 + key.readUInt32BE(0)).toString();
  const fp = fingerprint(key);
  const status = lookup(host.knownHostsFile, name, keyType, keyB64);
  if (status === 'match') return true;

  const strict = host.strictHostKeyChecking;
  if (strict === 'no' || strict === 'off') {
    if (status === 'mismatch') prompter.log(`[${host.alias}] WARNING: host key for ${name} changed (StrictHostKeyChecking=no)`);
    return true;
  }
  if (status === 'mismatch') {
    prompter.log(`[${host.alias}] HOST KEY MISMATCH for ${name} (${keyType} ${fp}). Refusing to connect.`);
    throw new Error(t('Host key for {0} has changed! Possible man-in-the-middle attack. Fix {1} manually.', name, host.knownHostsFile));
  }
  if (strict === 'yes') throw new Error(t('Unknown host key for {0} (StrictHostKeyChecking=yes): {1}', name, `${keyType} ${fp}`));

  const trusted = strict === 'accept-new' || (await prompter.confirmHostKey(name, `${keyType} ${fp}`));
  if (trusted) remember(host.knownHostsFile, `${name} ${keyType} ${keyB64}`, prompter);
  return trusted;
}

/** `host` for port 22, otherwise `[host]:port`, as OpenSSH writes it. */
export function knownHostsName(host: ResolvedHost): string {
  return host.port === 22 ? host.hostname : `[${host.hostname}]:${host.port}`;
}

export function fingerprint(key: Buffer): string {
  return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

function lookup(file: string, name: string, keyType: string, keyB64: string): 'match' | 'mismatch' | 'unknown' {
  let lines: string[];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return 'unknown';
  }
  let result: 'mismatch' | 'unknown' = 'unknown';
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('@')) continue;
    const [hosts, type, b64] = s.split(/\s+/);
    if (!b64 || !hostsFieldMatches(hosts, name)) continue;
    if (b64 === keyB64) return 'match';
    if (type === keyType) result = 'mismatch';
  }
  return result;
}

/** Hosts field: hashed `|1|salt|hash`, or comma-separated patterns with optional `!`. */
export function hostsFieldMatches(field: string, name: string): boolean {
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    return crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash;
  }
  let matched = false;
  for (const p of field.split(',')) {
    const negated = p.startsWith('!');
    if (globToRegex(negated ? p.slice(1) : p).test(name)) {
      if (negated) return false;
      matched = true;
    }
  }
  return matched;
}

function remember(file: string, entry: string, prompter: Prompter) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entry + '\n');
  } catch (e) {
    prompter.log(`Could not write ${file}: ${e}`);
  }
}
