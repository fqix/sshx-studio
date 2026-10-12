import * as vscode from 'vscode';
import type { ForwardState } from '../../forward/forwardManager';
import { formatForwardSpec, forwardFlag } from '../../forward/forwardSpec';
import { t } from '../../i18n';
import type { ForwardRecord } from '../../storage/forwardTypes';
import type { HostRecord } from '../../storage/types';

const ICONS: Record<ForwardState['status'], [string, string?]> = {
  stopped: ['circle-outline'],
  starting: ['loading~spin'],
  active: ['pass-filled', 'charts.green'],
  error: ['error', 'errorForeground'],
};

/** Level 2: one -L / -R port forward of a host. */
export class ForwardItem extends vscode.TreeItem {
  constructor(
    readonly host: HostRecord,
    readonly forward: ForwardRecord,
    readonly state: ForwardState,
  ) {
    super(`${forwardFlag(forward.kind)} ${forward.label || formatForwardSpec(forward)}`, vscode.TreeItemCollapsibleState.None);
    this.id = `forward:${forward.id}`;
    this.description = describe(forward, state);
    this.tooltip = tooltip(forward, state);
    const [icon, color] = ICONS[state.status];
    this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    // e.g. "forward.local.active" — menus match on kind and status.
    this.contextValue = `forward.${state.status === 'active' || state.status === 'starting' ? 'running' : 'stopped'}`;
  }
}

function describe(f: ForwardRecord, s: ForwardState): string {
  const parts: string[] = [];
  if (f.label) parts.push(formatForwardSpec(f));
  if (s.status === 'active' && f.bindPort === 0) parts.push(t('port {0}', s.port ?? '?'));
  if (s.status === 'error') parts.push(s.error ?? t('error'));
  if (f.autoStart) parts.push(t('auto-start'));
  return parts.join(' · ');
}

function tooltip(f: ForwardRecord, s: ForwardState): string {
  const listen = `${f.bindHost || (f.kind === 'remote' ? 'localhost' : '127.0.0.1')}:${s.port ?? f.bindPort}`;
  const target = `${f.targetHost}:${f.targetPort}`;
  const how = {
    local: () => t('Local {0} → (server) → {1}', listen, target),
    remote: () => t('Server {0} → (this machine) → {1}', listen, target),
    dynamic: () => t('SOCKS5/4 proxy on {0} → (server) → any destination', listen),
  }[f.kind]();
  const status = { stopped: t('Stopped'), starting: t('Starting…'), active: t('Active'), error: t('Error: {0}', s.error ?? '') }[s.status];
  return `${how}\n${status}`;
}
