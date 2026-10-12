import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from '../../shared/protocol';
import { t } from '../i18n';
import { generateKeyPair } from '../ssh/keygen';
import { errorMessage } from '../utils/async';
import { renderWebviewHtml, WEBVIEW_DIST } from '../session/webviewHtml';
import type { HostResolver, PromptSession } from '../ssh/types';
import { testConnection } from './connectionTester';
import { GeneratedKey, HostService, ValidationError } from './hostService';

/** What the editor needs from the rest of the extension. */
export interface HostEditorDeps {
  service: HostService;
  /** Resolves other hosts (e.g. jump hosts) when testing a connection. */
  resolver: HostResolver;
  newPromptSession: () => PromptSession;
}

const open = new Map<string, HostEditorPanel>();

/** Webview form for creating / editing a host. One panel per host. */
export class HostEditorPanel {
  private readonly panel: vscode.WebviewPanel;
  private generated?: GeneratedKey;

  static show(extensionUri: vscode.Uri, deps: HostEditorDeps, hostId?: number, title?: string) {
    const key = hostId === undefined ? 'new' : String(hostId);
    const existing = open.get(key);
    if (existing) return existing.panel.reveal();
    open.set(key, new HostEditorPanel(extensionUri, deps, key, hostId, title ?? t('New Host')));
  }

  private get service() {
    return this.deps.service;
  }

  private constructor(
    extensionUri: vscode.Uri,
    private readonly deps: HostEditorDeps,
    key: string,
    private readonly hostId: number | undefined,
    title: string,
  ) {
    this.panel = vscode.window.createWebviewPanel('sshxHostEditor', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST)],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, extensionUri, {
      view: 'hostEditor',
      locale: vscode.env.language,
      alias: title,
      terminalFontSize: 13,
    });
    this.panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.handle(m));
    this.panel.onDidDispose(() => open.delete(key));
  }

  private post(m: HostMessage) {
    this.panel.webview.postMessage(m);
  }

  private async handle(m: WebviewMessage) {
    try {
      switch (m.type) {
        case 'editor.ready':
          return this.post({ type: 'editor.init', state: await this.service.editorState(this.hostId) });
        case 'editor.cancel':
          return this.panel.dispose();
        case 'editor.browseKeyFile': {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: t('Use this key'),
            defaultUri: vscode.Uri.file(path.join(os.homedir(), '.ssh')),
          });
          if (picked?.[0]) this.post({ type: 'editor.keyFile', path: picked[0].fsPath });
          return;
        }
        case 'editor.generateKey': {
          const pair = generateKeyPair(m.keyType, `sshx-studio@${os.hostname()}`, m.passphrase || undefined);
          this.generated = { ...pair, passphrase: m.passphrase };
          return this.post({ type: 'editor.generated', publicKey: pair.publicKey });
        }
        case 'editor.copy':
          await vscode.env.clipboard.writeText(m.text);
          return vscode.window.setStatusBarMessage(t('Copied to clipboard'), 2000);
        case 'editor.test': {
          const host = await this.service.previewHost(m.draft, m.draft.authMethod === 'keyStored' ? this.generated : undefined);
          // Prompts work as usual, but nothing typed during a test is offered for saving.
          const result = await testConnection(host, this.deps.resolver, this.deps.newPromptSession().prompter);
          return this.post({ type: 'editor.testResult', ...result });
        }
        case 'editor.save': {
          const record = await this.service.save(m.draft, m.draft.authMethod === 'keyStored' ? this.generated : undefined);
          vscode.window.showInformationMessage(t('Saved host "{0}".', record.alias));
          return this.panel.dispose();
        }
      }
    } catch (e) {
      this.post({ type: 'editor.error', message: errorMessage(e), field: e instanceof ValidationError ? e.field : undefined });
    }
  }
}
