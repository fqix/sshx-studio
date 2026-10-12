import * as vscode from 'vscode';
import { formatForwardSpec, parseForwardSpec } from '../forward/forwardSpec';
import { t } from '../i18n';
import type { ForwardKind, ForwardRecord } from '../storage/forwardTypes';
import type { HostRecord } from '../storage/types';
import { errorMessage } from '../utils/async';
import type { ForwardItem } from '../views/hostTree/forwardItem';
import type { HostItem } from '../views/hostTree/hostItem';
import type { CommandContext } from './context';

export function registerForwardCommands(ctx: CommandContext): vscode.Disposable[] {
  const { forwards, forwardManager } = ctx;

  const start = async (host: HostRecord, f: ForwardRecord) => {
    try {
      await forwardManager.start(host.alias, f);
    } catch (e) {
      vscode.window.showErrorMessage(t('Port forward {0} failed: {1}', formatForwardSpec(f), errorMessage(e)));
    }
  };

  return [
    vscode.commands.registerCommand('sshxStudio.addForward', async (item?: HostItem) => {
      if (!item) return;
      const input = await askForward();
      if (!input) return;
      const created = await forwards.insert({ ...input, hostId: item.record.id, autoStart: false });
      await start(item.record, created);
    }),

    vscode.commands.registerCommand('sshxStudio.editForward', async (item?: ForwardItem) => {
      if (!item) return;
      const input = await askForward(item.forward);
      if (!input) return;
      const wasRunning = forwardManager.state(item.forward.id).status === 'active';
      await forwardManager.stop(item.forward.id);
      const updated = await forwards.update(item.forward.id, { ...item.forward, ...input });
      if (wasRunning) await start(item.host, updated);
    }),

    vscode.commands.registerCommand('sshxStudio.deleteForward', async (item?: ForwardItem) => {
      if (!item) return;
      await forwardManager.stop(item.forward.id);
      await forwards.delete(item.forward.id);
    }),

    vscode.commands.registerCommand('sshxStudio.startForward', (item?: ForwardItem) => item && start(item.host, item.forward)),

    vscode.commands.registerCommand('sshxStudio.stopForward', (item?: ForwardItem) => item && forwardManager.stop(item.forward.id)),

    vscode.commands.registerCommand('sshxStudio.toggleForwardAutoStart', async (item?: ForwardItem) => {
      if (item) await forwards.update(item.forward.id, { ...item.forward, autoStart: !item.forward.autoStart });
    }),

    vscode.commands.registerCommand('sshxStudio.copyForwardAddress', async (item?: ForwardItem) => {
      if (!item) return;
      const s = forwardManager.state(item.forward.id);
      const bind = item.forward.bindHost || (item.forward.kind === 'remote' ? 'localhost' : '127.0.0.1');
      await vscode.env.clipboard.writeText(`${bind}:${s.port ?? item.forward.bindPort}`);
      vscode.window.setStatusBarMessage(t('Copied to clipboard'), 2000);
    }),
  ];
}

/** Kind → `[bind:]port:host:hostport` → optional label. */
async function askForward(existing?: ForwardRecord) {
  let kind: ForwardKind | undefined = existing?.kind;
  if (!kind) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: t('-L  Local forward'), detail: t('Listen on this machine, connect to a host reachable from the server (e.g. a database behind it).'), forwardKind: 'local' as const },
        { label: t('-R  Remote forward'), detail: t('Listen on the server, connect back to a host reachable from this machine (e.g. a local dev server).'), forwardKind: 'remote' as const },
        { label: t('-D  Dynamic forward (SOCKS proxy)'), detail: t('A local SOCKS5/4 proxy; every connection goes out from the server (e.g. browse its internal network).'), forwardKind: 'dynamic' as const },
      ],
      { placeHolder: t('Type of port forward') },
    );
    kind = picked?.forwardKind;
  }
  if (!kind) return undefined;
  const k = kind;

  const spec = await vscode.window.showInputBox({
    title: { local: t('Local forward (-L)'), remote: t('Remote forward (-R)'), dynamic: t('Dynamic forward (-D)') }[k],
    prompt:
      k === 'dynamic'
        ? t('[bind_address:]port — same syntax as ssh -D')
        : t('[bind_address:]port:host:hostport — same syntax as ssh -{0}', k === 'local' ? 'L' : 'R'),
    placeHolder: { local: '8080:localhost:80   127.0.0.1:5433:db.internal:5432', remote: '9000:localhost:3000', dynamic: '1080   127.0.0.1:1080' }[k],
    value: existing ? formatForwardSpec(existing) : '',
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        parseForwardSpec(k, v);
        return undefined;
      } catch (e) {
        return errorMessage(e);
      }
    },
  });
  if (spec === undefined) return undefined;

  const label = await vscode.window.showInputBox({
    title: t('Label (optional)'),
    prompt: k === 'dynamic' ? t('A name shown in the tree, e.g. "Office network"') : t('A name shown in the tree, e.g. "Postgres"'),
    value: existing?.label ?? '',
    ignoreFocusOut: true,
  });
  if (label === undefined) return undefined;

  return { ...parseForwardSpec(k, spec), label: label.trim() };
}
