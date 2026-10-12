import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { databasePath, sshConfigPath } from '../storage/databasePath';
import type { CommandContext } from './context';

export function registerMiscCommands(ctx: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('sshxStudio.refresh', () => ctx.tree.refresh()),

    vscode.commands.registerCommand('sshxStudio.openConfig', async () => {
      const file = sshConfigPath();
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '', { mode: 0o600 });
      }
      await vscode.window.showTextDocument(vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('sshxStudio.revealDatabase', () =>
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(databasePath())),
    ),

    vscode.commands.registerCommand('sshxStudio.diagnose', () => {
      ctx.sessions.dumpDiagnostics();
      ctx.output.show(true);
    }),
  ];
}
