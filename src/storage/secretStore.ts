import type { HostSecrets } from '../config/types';

/** Minimal key/value secret API (VS Code's SecretStorage satisfies it). */
export interface SecretBackend {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

const KINDS = ['password', 'privateKey', 'passphrase'] as const;
type SecretKind = (typeof KINDS)[number];

/** Per-host secrets in the OS keychain (via VS Code SecretStorage), keyed by host id. */
export class HostSecretStore {
  constructor(private readonly backend: SecretBackend) {}

  async load(hostId: number): Promise<HostSecrets> {
    const [password, privateKey, passphrase] = await Promise.all(KINDS.map((k) => this.backend.get(key(hostId, k))));
    return { password, privateKey, passphrase };
  }

  /** Store defined values; `null` deletes; `undefined` leaves unchanged. */
  async save(hostId: number, secrets: { [K in SecretKind]?: string | null }) {
    await Promise.all(
      KINDS.filter((k) => secrets[k] !== undefined).map((k) =>
        secrets[k] === null ? this.backend.delete(key(hostId, k)) : this.backend.store(key(hostId, k), secrets[k]!),
      ),
    );
  }

  async clear(hostId: number) {
    await Promise.all(KINDS.map((k) => this.backend.delete(key(hostId, k))));
  }
}

const key = (hostId: number, kind: SecretKind) => `sshx.host.${hostId}.${kind}`;
