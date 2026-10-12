import type * as vscode from 'vscode';
import type { CommandContext } from './context';
import { registerForwardCommands } from './forwardCommands';
import { registerHostCommands } from './hostCommands';
import { registerMiscCommands } from './miscCommands';
import { registerUploadCommands } from './uploadCommands';

export type { CommandContext } from './context';

export function registerCommands(ctx: CommandContext): vscode.Disposable[] {
  return [...registerHostCommands(ctx), ...registerForwardCommands(ctx), ...registerUploadCommands(ctx), ...registerMiscCommands(ctx)];
}
