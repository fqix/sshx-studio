import type { AuthMethod } from '../config/types';

/** A row of the `hosts` table. Secrets live in SecretStorage, keyed by `id`. */
export interface HostRecord {
  id: number;
  alias: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  identityFile: string;
  /** OpenSSH public key for keyStored hosts (shown so users can install it). */
  publicKey: string;
  proxyJump: string;
  proxyCommand: string;
  /** Remaining ssh_config options, lowercase keyword → verbatim value. */
  options: Record<string, string>;
  source: 'manual' | 'ssh-config';
  /** Group (tree folder) the host is in; null = top level. */
  groupId: number | null;
  createdAt: number;
  updatedAt: number;
}

export type NewHost = Omit<HostRecord, 'id' | 'createdAt' | 'updatedAt'>;

/** A row of the `host_groups` table: a folder in the host tree. */
export interface GroupRecord {
  id: number;
  name: string;
  /** null = top level */
  parentId: number | null;
}
