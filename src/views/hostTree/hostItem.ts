import * as vscode from 'vscode';
import { t } from '../../i18n';
import type { HostRecord } from '../../storage/types';

/** Level 1: a host. Expands to its port forwards. */
export class HostItem extends vscode.TreeItem {
  constructor(
    readonly record: HostRecord,
    activeForwards: number,
  ) {
    super(record.alias, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `host:${record.id}`;
    this.description = describe(record);
    this.tooltip = tooltip(record);
    this.contextValue = record.publicKey ? 'host.withPublicKey' : 'host';
    this.iconPath = new vscode.ThemeIcon('vm', activeForwards ? new vscode.ThemeColor('charts.green') : undefined);
  }

  get alias() {
    return this.record.alias;
  }
}

function describe(h: HostRecord): string {
  const userAt = h.username ? `${h.username}@` : '';
  const via = h.proxyJump ? ` ⇢ ${h.proxyJump}` : h.proxyCommand ? ' ⇢ proxy' : '';
  return `${userAt}${h.hostname}${h.port !== 22 ? ':' + h.port : ''}${via}`;
}

const AUTH_LABELS = () => ({
  auto: t('Automatic'),
  password: t('Password'),
  keyFile: t('Private key file'),
  keyStored: t('Stored private key'),
});

function tooltip(h: HostRecord): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${h.alias}**\n\n`);
  const rows: [string, string][] = [
    [t('Host'), h.hostname],
    [t('Port'), String(h.port)],
    [t('User'), h.username || t('(current user)')],
    [t('Authentication'), AUTH_LABELS()[h.authMethod]],
  ];
  if (h.identityFile) rows.push([t('Key file'), h.identityFile]);
  if (h.proxyJump) rows.push(['ProxyJump', h.proxyJump]);
  if (h.proxyCommand) rows.push(['ProxyCommand', h.proxyCommand]);
  for (const [k, v] of rows) md.appendMarkdown(`${k}: \`${v.replace(/`/g, "'")}\`  \n`);
  return md;
}
