import { utils } from 'ssh2';
import { isEncryptedKeyError } from './auth';

export type KeyType = 'ed25519' | 'rsa';

export interface KeyPair {
  /** OpenSSH private key (PEM-like text). */
  privateKey: string;
  /** `ssh-ed25519 AAAA... comment` */
  publicKey: string;
}

export function generateKeyPair(type: KeyType, comment: string, passphrase?: string): KeyPair {
  const enc = passphrase ? { passphrase, cipher: 'aes256-ctr' } : {};
  const pair = type === 'rsa' ? utils.generateKeyPairSync('rsa', { bits: 4096, comment, ...enc }) : utils.generateKeyPairSync('ed25519', { comment, ...enc });
  return { privateKey: pair.private, publicKey: pair.public.trim() };
}

export type KeyCheck = { ok: true; publicKey: string } | { ok: false; reason: 'needsPassphrase' | 'wrongPassphrase' | 'invalid'; message: string };

/** Validate a private key (and passphrase) and derive its OpenSSH public key line. */
export function inspectPrivateKey(privateKey: string, passphrase?: string, comment = ''): KeyCheck {
  const parsed = utils.parseKey(privateKey, passphrase || undefined);
  if (parsed instanceof Error) {
    if (isEncryptedKeyError(parsed)) {
      return { ok: false, reason: passphrase ? 'wrongPassphrase' : 'needsPassphrase', message: parsed.message };
    }
    return { ok: false, reason: 'invalid', message: parsed.message };
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  const publicKey = `${key.type} ${key.getPublicSSH().toString('base64')}${comment ? ' ' + comment : ''}`;
  return { ok: true, publicKey };
}
