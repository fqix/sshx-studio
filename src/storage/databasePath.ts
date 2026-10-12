import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { expandHome } from '../config/tokens';

/** Local SQLite file: `sshxStudio.databasePath`, default ~/.sshx-studio/sshx.db. */
export function databasePath(): string {
  const configured = vscode.workspace.getConfiguration('sshxStudio').get<string>('databasePath');
  return configured ? expandHome(configured) : path.join(os.homedir(), '.sshx-studio', 'sshx.db');
}

/** ssh config used for importing and as a fallback resolver. */
export function sshConfigPath(): string {
  const configured = vscode.workspace.getConfiguration('sshxStudio').get<string>('configPath');
  return configured ? expandHome(configured) : path.join(os.homedir(), '.ssh', 'config');
}
