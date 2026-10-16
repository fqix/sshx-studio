import * as vscode from 'vscode';
import type { HostResolver, PromptSession } from '../ssh/types';
import { SessionPanel } from './sessionPanel';

/** Tracks open session panels. */
export class SessionRegistry implements vscode.Disposable {
  private readonly sessions = new Set<SessionPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly resolver: HostResolver,
    private readonly newPromptSession: () => PromptSession,
    private readonly output: vscode.OutputChannel,
  ) {}

  open(alias: string): SessionPanel {
    const session = new SessionPanel(this.extensionUri, this.resolver, this.newPromptSession, alias, this.output);
    this.sessions.add(session);
    session.onDidDispose(() => this.sessions.delete(session));
    return session;
  }

  /** The open session for `alias` (brought to front), or a new one. */
  findOrOpen(alias: string): SessionPanel {
    const existing = [...this.sessions].find((s) => s.alias === alias);
    if (!existing) return this.open(alias);
    existing.reveal();
    return existing;
  }

  /** The session tab that has focus, if any. */
  get active(): SessionPanel | undefined {
    return [...this.sessions].find((s) => s.active);
  }

  isOpen(alias: string): boolean {
    return [...this.sessions].some((s) => s.alias === alias);
  }

  /** Ask every webview to log its DOM state (diagnostics). */
  dumpDiagnostics() {
    for (const s of this.sessions) s.send({ type: 'debug.dump' });
  }

  dispose() {
    for (const s of [...this.sessions]) s.dispose();
  }
}
