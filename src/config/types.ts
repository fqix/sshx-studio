/**
 * How a host authenticates.
 * - auto: like OpenSSH — agent, identity files (or the defaults), then password
 * - password: saved password, else prompt
 * - keyFile: the configured identity file
 * - keyStored: a private key kept in VS Code SecretStorage (pasted or generated)
 */
export type { AuthMethod } from '../../shared/protocol';
import type { AuthMethod } from '../../shared/protocol';

/** Secrets loaded from SecretStorage for one host. Never persisted in the database. */
export interface HostSecrets {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/** Effective settings for one host, from the database or the ssh config. */
export interface ResolvedHost {
  /** Database id; undefined for hosts that only exist in ~/.ssh/config or ad-hoc ProxyJump specs. */
  id?: number;
  alias: string;
  hostname: string;
  port: number;
  user: string;
  authMethod: AuthMethod;
  identityFiles: string[];
  proxyCommand?: string;
  proxyJump?: string;
  identitiesOnly: boolean;
  identityAgent?: string;
  connectTimeout?: number;
  knownHostsFile: string;
  /** yes | no | off | accept-new | ask (default) */
  strictHostKeyChecking: string;
  serverAliveInterval?: number;
  /** ForwardAgent: false, true (default agent), or a specific agent socket path. */
  forwardAgent: boolean | string;
  /** ForwardX11: forward X11 connections from the session to the local display. */
  forwardX11: boolean;
  secrets: HostSecrets;
}
