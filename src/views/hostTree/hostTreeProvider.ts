import * as vscode from 'vscode';
import type { ForwardManager } from '../../forward/forwardManager';
import { t } from '../../i18n';
import type { ForwardRepository } from '../../storage/forwardRepository';
import type { GroupRepository } from '../../storage/groupRepository';
import type { HostRepository } from '../../storage/hostRepository';
import type { GroupRecord, HostRecord } from '../../storage/types';
import { errorMessage } from '../../utils/async';
import { groupErrorMessage } from './groupErrors';
import { ForwardItem } from './forwardItem';
import { GroupItem } from './groupItem';
import { HostItem } from './hostItem';

export const HOSTS_VIEW = 'sshxStudio.hosts';
export type HostTreeNode = GroupItem | HostItem | ForwardItem;

const DRAG_MIME = 'application/vnd.code.tree.sshxstudio.hosts';

/**
 * Groups (nestable folders), hosts and their port forwards, refreshed on data or forward-state changes.
 * Hosts and groups can be dragged onto a group, or onto empty space for the top level.
 */
export class HostTreeProvider implements vscode.TreeDataProvider<HostTreeNode>, vscode.TreeDragAndDropController<HostTreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly unsubscribe: (() => void)[];
  readonly onDidChangeTreeData = this.emitter.event;
  readonly dragMimeTypes = [DRAG_MIME];
  readonly dropMimeTypes = [DRAG_MIME];

  constructor(
    private readonly hosts: HostRepository,
    private readonly groups: GroupRepository,
    private readonly forwards: ForwardRepository,
    private readonly manager: ForwardManager,
  ) {
    const refresh = () => this.emitter.fire();
    // Groups share the database, so a host change notification covers them too.
    this.unsubscribe = [hosts.onDidChange(refresh), manager.onDidChange(refresh)];
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(node: HostTreeNode) {
    return node;
  }

  async getChildren(node?: HostTreeNode): Promise<HostTreeNode[]> {
    if (!node || node instanceof GroupItem) {
      const parentId = node ? node.group.id : null;
      const [groups, hosts] = await Promise.all([this.groups.list(), this.hosts.list()]);
      // A host whose group no longer exists (deleted in another window mid-refresh) shows at the top level.
      const known = new Set(groups.map((g) => g.id));
      const groupOf = (h: HostRecord) => (h.groupId !== null && known.has(h.groupId) ? h.groupId : null);
      const subgroups = groups.filter((g) => g.parentId === parentId).map((g) => new GroupItem(g, countHosts(g, groups, hosts, groupOf)));
      const items = await Promise.all(
        hosts
          .filter((h) => groupOf(h) === parentId)
          .map(async (h) => {
            const active = (await this.forwards.listForHost(h.id)).filter((f) => this.manager.state(f.id).status === 'active').length;
            return new HostItem(h, active);
          }),
      );
      return [...subgroups, ...items];
    }
    if (node instanceof HostItem) {
      return (await this.forwards.listForHost(node.record.id)).map((f) => new ForwardItem(node.record, f, this.manager.state(f.id)));
    }
    return [];
  }

  handleDrag(source: readonly HostTreeNode[], data: vscode.DataTransfer) {
    const payload = {
      hosts: source.filter((n) => n instanceof HostItem).map((n) => (n as HostItem).record.id),
      groups: source.filter((n) => n instanceof GroupItem).map((n) => (n as GroupItem).group.id),
    };
    if (payload.hosts.length || payload.groups.length) data.set(DRAG_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(target: HostTreeNode | undefined, data: vscode.DataTransfer) {
    const payload = data.get(DRAG_MIME)?.value as { hosts: number[]; groups: number[] } | undefined;
    if (!payload) return;
    // Dropping on a host or forward means "into the group that host is in".
    const groupId =
      target instanceof GroupItem ? target.group.id : target instanceof HostItem ? target.record.groupId : target instanceof ForwardItem ? target.host.groupId : null;
    try {
      if (payload.hosts.length) await this.hosts.moveToGroup(payload.hosts, groupId);
      for (const id of payload.groups) if (id !== groupId) await this.groups.move(id, groupId);
    } catch (e) {
      vscode.window.showErrorMessage(groupErrorMessage(e) ?? t('Could not move: {0}', errorMessage(e)));
    }
  }

  dispose() {
    this.unsubscribe.forEach((u) => u());
    this.emitter.dispose();
  }
}

/** Hosts in a group, including its subgroups. */
function countHosts(group: GroupRecord, groups: GroupRecord[], hosts: HostRecord[], groupOf: (h: HostRecord) => number | null): number {
  const children = groups.filter((g) => g.parentId === group.id);
  return hosts.filter((h) => groupOf(h) === group.id).length + children.reduce((n, c) => n + countHosts(c, groups, hosts, groupOf), 0);
}
