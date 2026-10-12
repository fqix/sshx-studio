/**
 * Localize a message. Inside VS Code this is `vscode.l10n.t` (translations in /l10n);
 * outside (unit tests) it just substitutes `{0}`-style arguments into the English source string.
 */
type Arg = string | number | boolean;

let impl: ((message: string, ...args: Arg[]) => string) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  impl = require('vscode').l10n.t;
} catch {
  impl = undefined;
}

export function t(message: string, ...args: Arg[]): string {
  if (impl) return impl(message, ...args);
  return message.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}
