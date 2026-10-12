import type { Tx } from './database';

/** Ordered schema migrations; index + 1 = schema version (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE hosts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    alias         TEXT    NOT NULL UNIQUE,
    hostname      TEXT    NOT NULL,
    port          INTEGER NOT NULL DEFAULT 22,
    username      TEXT    NOT NULL DEFAULT '',
    auth_method   TEXT    NOT NULL DEFAULT 'auto'
                  CHECK (auth_method IN ('auto', 'password', 'keyFile', 'keyStored')),
    identity_file TEXT    NOT NULL DEFAULT '',
    public_key    TEXT    NOT NULL DEFAULT '',
    proxy_jump    TEXT    NOT NULL DEFAULT '',
    proxy_command TEXT    NOT NULL DEFAULT '',
    -- other ssh_config options as JSON { "lowercasekeyword": "verbatim value" }
    options       TEXT    NOT NULL DEFAULT '{}',
    source        TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ssh-config')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`,
  /* 2 */ `
  CREATE TABLE port_forwards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id     INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('local', 'remote')),
    bind_host   TEXT    NOT NULL DEFAULT '',
    bind_port   INTEGER NOT NULL,
    target_host TEXT    NOT NULL,
    target_port INTEGER NOT NULL,
    label       TEXT    NOT NULL DEFAULT '',
    auto_start  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX port_forwards_host ON port_forwards(host_id)`,
  /* 3: add 'dynamic' (-D SOCKS). SQLite can't alter a CHECK constraint, so rebuild the table. */ `
  CREATE TABLE port_forwards_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id     INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('local', 'remote', 'dynamic')),
    bind_host   TEXT    NOT NULL DEFAULT '',
    bind_port   INTEGER NOT NULL,
    -- unused for 'dynamic'
    target_host TEXT    NOT NULL DEFAULT '',
    target_port INTEGER NOT NULL DEFAULT 0,
    label       TEXT    NOT NULL DEFAULT '',
    auto_start  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  INSERT INTO port_forwards_new SELECT id, host_id, kind, bind_host, bind_port, target_host, target_port, label, auto_start, created_at FROM port_forwards;
  DROP TABLE port_forwards;
  ALTER TABLE port_forwards_new RENAME TO port_forwards;
  CREATE INDEX port_forwards_host ON port_forwards(host_id)`,
];

/** Bring the schema up to date inside the caller's transaction. */
export function migrate(tx: Tx): void {
  const current = Number(tx.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    for (const statement of MIGRATIONS[v].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) tx.run(statement);
    tx.run(`PRAGMA user_version = ${v + 1}`);
  }
}
