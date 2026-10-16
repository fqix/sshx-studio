import type { AppDatabase, Row, Tx } from './database';
import type { GroupRecord } from './types';

/** Why a group change was refused; the UI turns it into a message. */
export class GroupError extends Error {
  constructor(readonly reason: 'exists' | 'cycle' | 'notFound') {
    super(`group ${reason}`);
  }
}

/** CRUD for `host_groups` (folders in the host tree). Names are unique per parent, case-insensitively. */
export class GroupRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(): Promise<GroupRecord[]> {
    return (await this.db.all('SELECT id, name, parent_id FROM host_groups ORDER BY name COLLATE NOCASE')).map(toRecord);
  }

  async findById(id: number): Promise<GroupRecord | undefined> {
    const row = await this.db.get('SELECT id, name, parent_id FROM host_groups WHERE id = ?', [id]);
    return row && toRecord(row);
  }

  async insert(name: string, parentId: number | null): Promise<GroupRecord> {
    const { lastId } = await this.db.transaction((tx) => {
      if (parentId !== null) requireGroup(tx, parentId);
      assertNameFree(tx, name, parentId);
      return tx.run('INSERT INTO host_groups (name, parent_id, created_at) VALUES (?, ?, ?)', [name, parentId, Date.now()]);
    });
    return (await this.findById(lastId))!;
  }

  async rename(id: number, name: string): Promise<void> {
    await this.db.transaction((tx) => {
      const g = requireGroup(tx, id);
      assertNameFree(tx, name, g.parentId, id);
      tx.run('UPDATE host_groups SET name = ? WHERE id = ?', [name, id]);
    });
  }

  /** Move a group under another one (null = top level). Refuses to move a group into itself or its own subgroup. */
  async move(id: number, parentId: number | null): Promise<void> {
    await this.db.transaction((tx) => {
      const g = requireGroup(tx, id);
      if (g.parentId === parentId) return;
      for (let p = parentId; p !== null; p = requireGroup(tx, p).parentId) {
        if (p === id) throw new GroupError('cycle');
      }
      assertNameFree(tx, g.name, parentId, id);
      tx.run('UPDATE host_groups SET parent_id = ? WHERE id = ?', [parentId, id]);
    });
  }

  /** Delete a group and its subgroups. Their hosts are kept and move to the deleted group's parent. */
  async delete(id: number): Promise<void> {
    await this.db.transaction((tx) => {
      const g = requireGroup(tx, id);
      tx.run(
        `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT g.id FROM host_groups g JOIN sub ON g.parent_id = sub.id)
         UPDATE hosts SET group_id = ? WHERE group_id IN (SELECT id FROM sub)`,
        [id, g.parentId],
      );
      tx.run('DELETE FROM host_groups WHERE id = ?', [id]);
    });
  }
}

/** "Parent / Child" path of every group, for pickers. */
export function groupPaths(groups: GroupRecord[]): Map<number, string> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const paths = new Map<number, string>();
  const pathOf = (g: GroupRecord, depth = 0): string => {
    const cached = paths.get(g.id);
    if (cached !== undefined) return cached;
    const parent = g.parentId === null || depth > groups.length ? undefined : byId.get(g.parentId);
    const p = parent ? `${pathOf(parent, depth + 1)} / ${g.name}` : g.name;
    paths.set(g.id, p);
    return p;
  };
  groups.forEach((g) => pathOf(g));
  return paths;
}

/** The group and all groups below it. */
export function descendantIds(groups: GroupRecord[], id: number): Set<number> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) {
      if (g.parentId !== null && out.has(g.parentId) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
    }
  }
  return out;
}

function requireGroup(tx: Tx, id: number): GroupRecord {
  const row = tx.get('SELECT id, name, parent_id FROM host_groups WHERE id = ?', [id]);
  if (!row) throw new GroupError('notFound');
  return toRecord(row);
}

function assertNameFree(tx: Tx, name: string, parentId: number | null, exceptId = 0) {
  const clash = tx.get('SELECT 1 FROM host_groups WHERE IFNULL(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND id != ?', [parentId ?? 0, name, exceptId]);
  if (clash) throw new GroupError('exists');
}

function toRecord(r: Row): GroupRecord {
  return { id: Number(r.id), name: String(r.name), parentId: r.parent_id === null ? null : Number(r.parent_id) };
}
