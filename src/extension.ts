import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SshConfig } from './config/sshConfig';
import { ForwardManager } from './forward/forwardManager';
import { HostService } from './hosts/hostService';
import { t } from './i18n';
import { createPromptSession } from './session/promptSession';
import { SessionRegistry } from './session/sessionRegistry';
import { AppDatabase } from './storage/database';
import { databasePath, sshConfigPath } from './storage/databasePath';
import { ForwardRepository } from './storage/forwardRepository';
import { HostRepository } from './storage/hostRepository';
import { DatabaseHostResolver } from './storage/hostResolver';
import { HostSecretStore } from './storage/secretStore';
import { importOnFirstRun } from './storage/sshConfigImporter';
import { errorMessage } from './utils/async';
import { HOSTS_VIEW, HostTreeProvider } from './views/hostTree/hostTreeProvider';

export async function activate(ctx: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('SSHX Studio');
  ctx.subscriptions.push(output);

  // Storage: local SQLite for hosts/forwards, OS keychain for secrets.
  const db = await AppDatabase.open(databasePath());
  ctx.subscriptions.push({ dispose: () => void db.close() });
  const hosts = new HostRepository(db);
  const forwards = new ForwardRepository(db);
  const secrets = new HostSecretStore(ctx.secrets);
  output.appendLine(`database: ${databasePath()}`);

  const firstRun = await importOnFirstRun(hosts, sshConfigPath());
  if (firstRun?.imported) {
    vscode.window.showInformationMessage(t('Imported {0} host(s) from {1}.', firstRun.imported, sshConfigPath()));
  }

  // Connections
  const resolver = new DatabaseHostResolver(hosts, secrets, () => new SshConfig(sshConfigPath()));
  const newPromptSession = () => createPromptSession(output, secrets);
  const forwardManager = new ForwardManager(resolver, newPromptSession, (m) => output.appendLine(m));
  const sessions = new SessionRegistry(ctx.extensionUri, resolver, newPromptSession, output);

  // UI
  const tree = new HostTreeProvider(hosts, forwards, forwardManager);
  const hostService = new HostService(hosts, secrets);

  ctx.subscriptions.push(
    sessions,
    tree,
    { dispose: () => forwardManager.dispose() },
    vscode.window.registerTreeDataProvider(HOSTS_VIEW, tree),
    ...registerCommands({ extensionUri: ctx.extensionUri, output, hosts, forwards, hostService, resolver, newPromptSession, forwardManager, sessions, tree }),
  );

  // Auto-start forwards in the background.
  for (const f of await forwards.listAutoStart()) {
    const host = await hosts.findById(f.hostId);
    if (host) forwardManager.start(host.alias, f).catch((e) => output.appendLine(`auto-start ${host.alias}: ${errorMessage(e)}`));
  }

  // Internal handles for integration tests (not a public API).
  return { hosts, forwards, forwardManager, sessions };
}

export function deactivate() {}
