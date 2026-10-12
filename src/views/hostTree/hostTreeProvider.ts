import * as vscode from 'vscode';
import type { ForwardManager } from '../../forward/forwardManager';
import type { ForwardRepository } from '../../storage/forwardRepository';
import type { HostRepository } from '../../storage/hostRepository';
import { ForwardItem } from './forwardItem';
import { HostItem } from './hostItem';

export const HOSTS_VIEW = 'sshxStudio.hosts';
export type HostTreeNode = HostItem | ForwardItem;

/** Hosts (level 1) and their port forwards (level 2), refreshed on data or forward-state changes. */
export class HostTreeProvider implements vscode.TreeDataProvider<HostTreeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly unsubscribe: (() => void)[];
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly hosts: HostRepository,
    private readonly forwards: ForwardRepository,
    private readonly manager: ForwardManager,
  ) {
    const refresh = () => this.emitter.fire();
    this.unsubscribe = [hosts.onDidChange(refresh), manager.onDidChange(refresh)];
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(node: HostTreeNode) {
    return node;
  }

  async getChildren(node?: HostTreeNode): Promise<HostTreeNode[]> {
    if (!node) {
      return Promise.all(
        (await this.hosts.list()).map(async (h) => {
          const active = (await this.forwards.listForHost(h.id)).filter((f) => this.manager.state(f.id).status === 'active').length;
          return new HostItem(h, active);
        }),
      );
    }
    if (node instanceof HostItem) {
      return (await this.forwards.listForHost(node.record.id)).map((f) => new ForwardItem(node.record, f, this.manager.state(f.id)));
    }
    return [];
  }

  dispose() {
    this.unsubscribe.forEach((u) => u());
    this.emitter.dispose();
  }
}
