import * as vscode from 'vscode';
import { t } from '../i18n';
import { descendantIds, groupPaths } from '../storage/groupRepository';
import { groupErrorMessage } from '../views/hostTree/groupErrors';
import { GroupItem } from '../views/hostTree/groupItem';
import { HostItem } from '../views/hostTree/hostItem';
import type { HostTreeNode } from '../views/hostTree/hostTreeProvider';
import type { CommandContext } from './context';

export function registerGroupCommands(ctx: CommandContext): vscode.Disposable[] {
  const { groups, hosts } = ctx;

  const askName = (title: string, value = '') =>
    vscode.window.showInputBox({
      title,
      value,
      prompt: t('Group name'),
      validateInput: (v) => (v.trim() ? undefined : t('Name is required.')),
    });

  /** Run a group change, showing refusals (duplicate name, cycle) as messages. */
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const message = groupErrorMessage(e);
      if (!message) throw e;
      vscode.window.showErrorMessage(message);
    }
  };

  return [
    vscode.commands.registerCommand('sshxStudio.addGroup', async (item?: GroupItem) => {
      const parentId = item instanceof GroupItem ? item.group.id : null;
      const name = await askName(item instanceof GroupItem ? t('New subgroup in {0}', item.group.name) : t('New group'));
      if (name) await attempt(() => groups.insert(name.trim(), parentId));
    }),

    vscode.commands.registerCommand('sshxStudio.renameGroup', async (item: GroupItem) => {
      const name = await askName(t('Rename group'), item.group.name);
      if (name && name.trim() !== item.group.name) await attempt(() => groups.rename(item.group.id, name.trim()));
    }),

    vscode.commands.registerCommand('sshxStudio.deleteGroup', async (item: GroupItem) => {
      const all = await groups.list();
      const inside = descendantIds(all, item.group.id);
      const hostCount = (await hosts.list()).filter((h) => h.groupId !== null && inside.has(h.groupId)).length;
      const parent = item.group.parentId === null ? undefined : all.find((g) => g.id === item.group.parentId);
      const detail = [
        inside.size > 1 ? t('Its subgroups will be deleted too.') : '',
        !hostCount ? '' : parent ? t('The {0} host(s) inside are kept and move to "{1}".', hostCount, parent.name) : t('The {0} host(s) inside are kept and move to the top level.', hostCount),
      ];
      const del = t('Delete');
      const choice = await vscode.window.showWarningMessage(
        t('Delete group "{0}"?', item.group.name),
        { modal: true, detail: detail.filter(Boolean).join(' ') || undefined },
        del,
      );
      if (choice === del) await attempt(() => groups.delete(item.group.id));
    }),

    vscode.commands.registerCommand('sshxStudio.moveToGroup', async (item?: HostItem | GroupItem, selected?: HostTreeNode[]) => {
      const nodes = (selected?.length ? selected : item ? [item] : []).filter((n) => n instanceof HostItem || n instanceof GroupItem);
      if (!nodes.length) return;
      const all = await groups.list();
      // A group can't go into itself or anything below it.
      const excluded = new Set<number>();
      for (const n of nodes) if (n instanceof GroupItem) descendantIds(all, n.group.id).forEach((id) => excluded.add(id));
      const paths = groupPaths(all);
      const picks: (vscode.QuickPickItem & { groupId: number | null | 'new' })[] = [
        { label: `$(root-folder) ${t('Top level')}`, groupId: null },
        ...all
          .filter((g) => !excluded.has(g.id))
          .map((g) => ({ label: `$(folder) ${paths.get(g.id)}`, groupId: g.id }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        { label: `$(new-folder) ${t('New group…')}`, groupId: 'new' },
      ];
      const picked = await vscode.window.showQuickPick(picks, { placeHolder: t('Move to group') });
      if (!picked) return;
      await attempt(async () => {
        let target = picked.groupId;
        if (target === 'new') {
          const name = await askName(t('New group'));
          if (!name) return;
          target = (await groups.insert(name.trim(), null)).id;
        }
        const hostIds = nodes.filter((n) => n instanceof HostItem).map((n) => (n as HostItem).record.id);
        if (hostIds.length) await hosts.moveToGroup(hostIds, target);
        for (const n of nodes) if (n instanceof GroupItem && n.group.id !== target) await groups.move(n.group.id, target);
      });
    }),
  ];
}
