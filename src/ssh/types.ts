import type { Client } from 'ssh2';
import type { ResolvedHost } from '../config/types';

/** UI callbacks the connection layer needs; implemented with VS Code dialogs in the extension. */
export interface Prompter {
  password(host: ResolvedHost, message: string): Promise<string | undefined>;
  passphrase(host: ResolvedHost, keyLabel: string): Promise<string | undefined>;
  /** Unknown host key. Return true to trust & remember. */
  confirmHostKey(host: string, fingerprint: string): Promise<boolean>;
  log(message: string): void;
}

/** Looks up connection settings by alias (database, ssh config, ...). */
export interface HostResolver {
  resolve(alias: string): ResolvedHost | Promise<ResolvedHost>;
}

export interface SshConnection {
  client: Client;
  host: ResolvedHost;
  /** Closes this connection and every jump host / proxy process under it. */
  dispose(): void;
}

/**
 * A Prompter for one connection attempt. `onConnected` runs after a successful login
 * (e.g. to offer saving a password the user typed).
 */
export interface PromptSession {
  prompter: Prompter;
  onConnected(): Promise<void>;
}
