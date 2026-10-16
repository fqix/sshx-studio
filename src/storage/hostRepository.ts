import type { AuthMethod } from '../config/types';
import type { AppDatabase, Row, Tx } from './database';
import type { HostRecord, NewHost } from './types';

const COLUMNS = `id, alias, hostname, port, username, auth_method, identity_file, public_key,
  proxy_jump, proxy_command, options, source, group_id, created_at, updated_at`;
const INSERT = `INSERT INTO hosts (alias, hostname, port, username, auth_method, identity_file, public_key,
  proxy_jump, proxy_command, options, group_id, source, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** CRUD for the `hosts` table plus the `meta` key/value table. */
export class HostRepository {
  constructor(private readonly db: AppDatabase) {}

  onDidChange(listener: () => void) {
    return this.db.onDidChange(listener);
  }

  async list(): Promise<HostRecord[]> {
    return (await this.db.all(`SELECT ${COLUMNS} FROM hosts ORDER BY alias COLLATE NOCASE`)).map(toRecord);
  }

  async findById(id: number): Promise<HostRecord | undefined> {
    const row = await this.db.get(`SELECT ${COLUMNS} FROM hosts WHERE id = ?`, [id]);
    return row && toRecord(row);
  }

  async findByAlias(alias: string): Promise<HostRecord | undefined> {
    const row = await this.db.get(`SELECT ${COLUMNS} FROM hosts WHERE alias = ?`, [alias]);
    return row && toRecord(row);
  }

  async insert(host: NewHost): Promise<HostRecord> {
    const { lastId } = await this.db.transaction((tx) => insertRow(tx, host));
    return (await this.findById(lastId))!;
  }

  /** Insert hosts whose alias doesn't exist yet, in one transaction. Returns alias → new id. */
  insertMissing(hosts: NewHost[], each?: (tx: Tx, id: number, host: NewHost) => void): Promise<Map<string, number>> {
    return this.db.transaction((tx) => {
      const inserted = new Map<string, number>();
      for (const h of hosts) {
        if (tx.get('SELECT 1 FROM hosts WHERE alias = ?', [h.alias])) continue;
        const { lastId } = insertRow(tx, h);
        inserted.set(h.alias, lastId);
        each?.(tx, lastId, h);
      }
      return inserted;
    });
  }

  async update(id: number, host: Omit<NewHost, 'source'>): Promise<HostRecord> {
    await this.db.transaction((tx) =>
      tx.run(
        `UPDATE hosts SET alias = ?, hostname = ?, port = ?, username = ?, auth_method = ?, identity_file = ?,
           public_key = ?, proxy_jump = ?, proxy_command = ?, options = ?, group_id = ?, updated_at = ?
         WHERE id = ?`,
        [...toParams(host), Date.now(), id],
      ),
    );
    return (await this.findById(id))!;
  }

  async delete(id: number): Promise<void> {
    await this.db.transaction((tx) => tx.run('DELETE FROM hosts WHERE id = ?', [id]));
  }

  /** Move hosts into a group (null = top level). */
  async moveToGroup(ids: number[], groupId: number | null): Promise<void> {
    await this.db.transaction((tx) => {
      for (const id of ids) tx.run('UPDATE hosts SET group_id = ?, updated_at = ? WHERE id = ?', [groupId, Date.now(), id]);
    });
  }

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.transaction((tx) =>
      tx.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]),
    );
  }
}

function insertRow(tx: Tx, h: NewHost) {
  const now = Date.now();
  return tx.run(INSERT, [...toParams(h), h.source, now, now]);
}

function toParams(h: Omit<NewHost, 'source'>) {
  return [h.alias, h.hostname, h.port, h.username, h.authMethod, h.identityFile, h.publicKey, h.proxyJump, h.proxyCommand, JSON.stringify(h.options ?? {}), h.groupId ?? null];
}

function toRecord(r: Row): HostRecord {
  return {
    id: Number(r.id),
    alias: String(r.alias),
    hostname: String(r.hostname),
    port: Number(r.port),
    username: String(r.username),
    authMethod: r.auth_method as AuthMethod,
    identityFile: String(r.identity_file),
    publicKey: String(r.public_key),
    proxyJump: String(r.proxy_jump),
    proxyCommand: String(r.proxy_command),
    options: JSON.parse(String(r.options)),
    source: r.source as HostRecord['source'],
    groupId: r.group_id === null ? null : Number(r.group_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}
