import type * as vscode from 'vscode';

export type Logger = (message: string) => void;

/** Logger that prefixes every line with `[scope]`. */
export function scopedLogger(channel: vscode.OutputChannel, scope: string): Logger {
  return (message) => channel.appendLine(`[${scope}] ${message}`);
}
