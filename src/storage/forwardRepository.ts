import type { AppDatabase, Row, Tx } from './database';
import type { ForwardKind, ForwardRecord, NewForward } from './forwardTypes';

const COLUMNS = 'id, host_id, kind, bind_host, bind_port, target_host, target_port, label, auto_start, created_at';
const INSERT = `INSERT INTO port_forwards (host_id, kind, bind_host, bind_port, target_host, target_port, label, auto_start, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** CRUD for the `port_forwards` table. */
export class ForwardRepository {
  constructor(private readonly db: AppDatabase) {}

  async listForHost(hostId: number): Promise<ForwardRecord[]> {
    return (await this.db.all(`SELECT ${COLUMNS} FROM port_forwards WHERE host_id = ? ORDER BY kind, bind_port`, [hostId])).map(toRecord);
  }

  async listAutoStart(): Promise<ForwardRecord[]> {
    return (await this.db.all(`SELECT ${COLUMNS} FROM port_forwards WHERE auto_start = 1`)).map(toRecord);
  }

  async findById(id: number): Promise<ForwardRecord | undefined> {
    const row = await this.db.get(`SELECT ${COLUMNS} FROM port_forwards WHERE id = ?`, [id]);
    return row && toRecord(row);
  }

  async insert(f: NewForward): Promise<ForwardRecord> {
    const { lastId } = await this.db.transaction((tx) => ForwardRepository.insertIn(tx, f));
    return (await this.findById(lastId))!;
  }

  /** Insert inside an existing transaction (e.g. while importing hosts). */
  static insertIn(tx: Tx, f: NewForward) {
    return tx.run(INSERT, [...toParams(f), Date.now()]);
  }

  async update(id: number, f: NewForward): Promise<ForwardRecord> {
    await this.db.transaction((tx) =>
      tx.run(
        `UPDATE port_forwards SET host_id = ?, kind = ?, bind_host = ?, bind_port = ?, target_host = ?, target_port = ?,
           label = ?, auto_start = ? WHERE id = ?`,
        [...toParams(f), id],
      ),
    );
    return (await this.findById(id))!;
  }

  async delete(id: number): Promise<void> {
    await this.db.transaction((tx) => tx.run('DELETE FROM port_forwards WHERE id = ?', [id]));
  }
}

function toParams(f: NewForward) {
  return [f.hostId, f.kind, f.bindHost, f.bindPort, f.targetHost, f.targetPort, f.label, f.autoStart ? 1 : 0];
}

function toRecord(r: Row): ForwardRecord {
  return {
    id: Number(r.id),
    hostId: Number(r.host_id),
    kind: r.kind as ForwardKind,
    bindHost: String(r.bind_host),
    bindPort: Number(r.bind_port),
    targetHost: String(r.target_host),
    targetPort: Number(r.target_port),
    label: String(r.label),
    autoStart: Number(r.auto_start) === 1,
    createdAt: Number(r.created_at),
  };
}
