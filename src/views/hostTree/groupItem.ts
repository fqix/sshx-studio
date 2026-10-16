import * as vscode from 'vscode';
import type { GroupRecord } from '../../storage/types';

/** A folder of hosts (and subgroups). */
export class GroupItem extends vscode.TreeItem {
  constructor(
    readonly group: GroupRecord,
    hostCount: number,
  ) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `group:${group.id}`;
    this.description = hostCount ? String(hostCount) : undefined;
    this.contextValue = 'group';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}
