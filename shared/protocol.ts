/**
 * Message protocol between the extension host and the webview UI.
 * Imported by both sides (`src/` and `webview-ui/`), so keep it dependency-free.
 */

export interface FileEntry {
  name: string;
  type: 'dir' | 'file' | 'link';
  size: number;
  /** seconds since epoch */
  mtime: number;
  mode: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// --------------------------------------------------------------- transfers

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'paused';

/** One upload/download shown in the file pane (a file, a folder, or a dropped file). */
export interface TransferItem {
  id: number;
  direction: TransferDirection;
  /** Top-level name (file or folder). */
  name: string;
  /** Total files (folders expand to many); 0 while still scanning. */
  files: number;
  filesDone: number;
  /** File currently being transferred (for folders). */
  currentFile?: string;
  totalBytes: number;
  doneBytes: number;
  bytesPerSecond: number;
  status: TransferStatus;
  error?: string;
  /** Finished download that can be shown in the OS file manager. */
  canReveal: boolean;
  /** Paused or failed, with the partial file kept: Resume continues where it stopped. */
  canResume: boolean;
}

// ------------------------------------------------------------- host editor

export type AuthMethod = 'auto' | 'password' | 'keyFile' | 'keyStored';
export type KeyType = 'ed25519' | 'rsa';

/** Host form contents. Secret fields are write-only: empty means "keep what is saved". */
export interface HostDraft {
  id?: number;
  alias: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  identityFile: string;
  proxyJump: string;
  proxyCommand: string;
  /** Group (tree folder); null = top level. */
  groupId: number | null;
  password: string;
  clearPassword: boolean;
  /** Pasted private key (keyStored). */
  privateKey: string;
  passphrase: string;
  clearPassphrase: boolean;
  /** ssh -A */
  forwardAgent: boolean;
  /** ssh -X */
  forwardX11: boolean;
}

export interface HostEditorState {
  draft: HostDraft;
  /** Which secrets already exist in the keychain. */
  saved: { password: boolean; privateKey: boolean; passphrase: boolean };
  /** Public key of the stored / generated key. */
  publicKey: string;
  /** Other hosts' aliases (for the ProxyJump picker). */
  otherAliases: string[];
  /** Every group, with its full "Parent / Child" path, sorted by path. */
  groups: { id: number; path: string }[];
}

export type HostDraftField = keyof HostDraft;

/** webview → extension */
export type WebviewMessage =
  /** The page is up; connect and open the shell for its first terminal. */
  | { type: 'ready'; term: number; cols: number; rows: number }
  /** Another terminal in this tab: a new shell on the same connection. Ids are chosen by the webview. */
  | { type: 'term.open'; term: number; cols: number; rows: number }
  | { type: 'term.close'; term: number }
  | { type: 'term.input'; term: number; data: string }
  | { type: 'term.resize'; term: number; cols: number; rows: number }
  | { type: 'reconnect' }
  | { type: 'fs.list'; path: string }
  | { type: 'fs.download'; paths: string[] }
  | { type: 'fs.upload'; dir: string; folder: boolean }
  | { type: 'fs.drop'; dir: string; name: string; data: Uint8Array }
  | { type: 'fs.mkdir'; dir: string }
  | { type: 'fs.delete'; paths: string[] }
  | { type: 'fs.rename'; path: string }
  | { type: 'fs.open'; path: string }
  | { type: 'fs.cdTerminal'; path: string; term: number }
  /** Local pane (this machine). `path` '' = the default folder (workspace or home). */
  | { type: 'local.list'; path: string }
  | { type: 'local.open'; path: string }
  | { type: 'local.reveal'; path: string }
  | { type: 'local.mkdir'; dir: string }
  | { type: 'local.rename'; path: string }
  | { type: 'local.delete'; paths: string[] }
  /** Between the panes: local paths into a remote folder, remote paths into a local folder. */
  | { type: 'xfer.upload'; paths: string[]; dir: string }
  | { type: 'xfer.download'; paths: string[]; dir: string }
  | { type: 'log'; message: string }
  | { type: 'transfer.cancel'; id: number }
  | { type: 'transfer.pause'; id: number }
  | { type: 'transfer.resume'; id: number }
  | { type: 'transfer.reveal'; id: number }
  | { type: 'transfer.clearFinished' }
  | { type: 'editor.ready' }
  | { type: 'editor.save'; draft: HostDraft }
  | { type: 'editor.test'; draft: HostDraft }
  | { type: 'editor.cancel' }
  | { type: 'editor.browseKeyFile' }
  | { type: 'editor.generateKey'; keyType: KeyType; passphrase: string }
  | { type: 'editor.copy'; text: string };

/** extension → webview */
export type HostMessage =
  | { type: 'status'; state: ConnectionState; text: string }
  | { type: 'term.data'; term: number; data: string }
  /** Add a terminal to this tab (from the editor title bar). */
  | { type: 'term.new' }
  | { type: 'fs.loading' }
  | { type: 'fs.home'; home: string }
  | { type: 'fs.listing'; path: string; entries: FileEntry[] }
  | { type: 'fs.error'; message: string }
  /** Local paths use the host OS's separator; `parent` equals `path` at a root. */
  | { type: 'local.listing'; path: string; parent: string; home: string; sep: string; entries: FileEntry[] }
  | { type: 'local.error'; message: string }
  | { type: 'debug.dump' }
  | { type: 'transfer.update'; items: TransferItem[] }
  | { type: 'editor.init'; state: HostEditorState }
  | { type: 'editor.keyFile'; path: string }
  | { type: 'editor.generated'; publicKey: string }
  | { type: 'editor.error'; message: string; field?: HostDraftField }
  | { type: 'editor.testResult'; ok: boolean; message: string; details: string[] };

/** Static settings the extension injects into the page (as JSON in `#root[data-config]`). */
export interface WebviewConfig {
  /** Which page to render. */
  view: 'session' | 'hostEditor';
  /** VS Code display language, e.g. "en" or "zh-cn". */
  locale: string;
  alias: string;
  terminalFontSize: number;
}
