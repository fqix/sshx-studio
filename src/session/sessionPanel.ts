import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from '../../shared/protocol';
import { connect } from '../ssh/connect';
import type { HostResolver, PromptSession, SshConnection } from '../ssh/types';
import { t } from '../i18n';
import { errorDetail, errorMessage } from '../utils/async';
import { Logger, scopedLogger } from '../utils/logger';
import { FileController } from './fileController';
import { RemoteEditor } from './remoteEditor';
import { TerminalChannel } from './terminalChannel';
import { renderWebviewHtml, WEBVIEW_DIST } from './webviewHtml';

/** One webview tab = one SSH connection with a terminal and an SFTP file pane. */
export class SessionPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly log: Logger;
  private readonly terminal: TerminalChannel;
  private readonly files: FileController;
  private readonly editor: RemoteEditor;
  private readonly disposables: vscode.Disposable[] = [];
  private connection?: SshConnection;
  private disposed = false;
  private readonly onDisposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.onDisposeEmitter.event;

  constructor(
    extensionUri: vscode.Uri,
    private readonly resolver: HostResolver,
    private readonly newPromptSession: () => PromptSession,
    readonly alias: string,
    output: vscode.OutputChannel,
  ) {
    this.log = scopedLogger(output, alias);
    const send = (m: HostMessage) => this.send(m);
    this.terminal = new TerminalChannel(send, this.log);
    this.files = new FileController(alias, send, this.log);
    this.editor = new RemoteEditor(alias, () => this.files.fs, (dir) => this.files.refresh(dir));

    this.panel = vscode.window.createWebviewPanel('sshxSession', alias, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST)],
    });
    const terminalFontSize = vscode.workspace.getConfiguration('sshxStudio').get<number>('terminalFontSize', 13);
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, extensionUri, {
      view: 'session',
      locale: vscode.env.language,
      alias,
      terminalFontSize,
    });
    this.panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.handle(m), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  reveal() {
    this.panel.reveal();
  }

  /** Resolves when the file pane's SFTP session is ready (rejects if it couldn't be opened). */
  whenFilesReady(): Promise<void> {
    return this.files.whenReady();
  }

  /** The remote folder currently shown in the file pane. */
  get remoteDir(): string {
    return this.files.shownDir;
  }

  /** Queue uploads of local paths; progress shows in this tab's transfer list. */
  uploadLocal(localPaths: string[], dir: string) {
    this.files.uploadLocal(localPaths, dir);
  }

  send(m: HostMessage) {
    if (!this.disposed) this.panel.webview.postMessage(m);
  }

  // ----------------------------------------------------------- connection

  private async connect() {
    this.disconnect();
    this.send({ type: 'status', state: 'connecting', text: t('Connecting to {0}…', this.alias) });
    this.log('connecting');
    try {
      const session = this.newPromptSession();
      const conn = await connect(this.resolver, this.alias, session.prompter);
      void session.onConnected();
      if (this.disposed) return conn.dispose();
      this.connection = conn;
      conn.client.on('close', () => {
        if (this.disposed || this.connection !== conn) return;
        this.send({ type: 'status', state: 'disconnected', text: t('Disconnected') });
        this.detachChannels();
      });
      this.send({ type: 'status', state: 'connected', text: `${conn.host.user}@${conn.host.hostname}` });
      // Independent channels: a failure in one must not take down the other.
      await Promise.all([this.terminal.open(conn.client, conn.host), this.files.attach(conn.client)]);
    } catch (e) {
      this.log(errorDetail(e));
      this.send({ type: 'status', state: 'error', text: errorMessage(e) });
      this.disconnect();
      this.files.connectionFailed(e);
    }
  }

  private detachChannels() {
    this.terminal.detach();
    this.files.detach();
  }

  private disconnect() {
    this.detachChannels();
    this.connection?.dispose();
    this.connection = undefined;
  }

  // -------------------------------------------------------------- routing

  private async handle(m: WebviewMessage) {
    try {
      switch (m.type) {
        case 'ready':
          this.terminal.resize(m.cols, m.rows);
          return await this.connect();
        case 'reconnect':
          return await this.connect();
        case 'term.input':
          return this.terminal.input(m.data);
        case 'term.resize':
          return this.terminal.resize(m.cols, m.rows);
        case 'fs.cdTerminal':
          return this.terminal.cd(m.path);
        case 'fs.list':
          return await this.files.list(m.path);
        case 'fs.download':
          return await this.files.download(m.paths);
        case 'fs.upload':
          return await this.files.upload(m.dir, m.folder);
        case 'fs.drop':
          return this.files.drop(m.dir, m.name, m.data);
        case 'fs.mkdir':
          return await this.files.mkdir(m.dir);
        case 'fs.delete':
          return await this.files.remove(m.paths);
        case 'fs.rename':
          return await this.files.rename(m.path);
        case 'fs.open':
          return await this.editor.open(m.path);
        case 'transfer.cancel':
          return this.files.cancelTransfer(m.id);
        case 'transfer.reveal':
          return this.files.revealTransfer(m.id);
        case 'transfer.clearFinished':
          return this.files.clearFinishedTransfers();
        case 'log':
          return this.log(`webview: ${m.message}`);
      }
    } catch (e) {
      this.log(`${m.type}: ${errorDetail(e)}`);
      vscode.window.showErrorMessage(`${this.alias}: ${errorMessage(e)}`);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect();
    this.files.dispose();
    this.editor.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
    this.onDisposeEmitter.fire();
    this.onDisposeEmitter.dispose();
  }
}
