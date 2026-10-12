// Storage layer: migrations, host/forward CRUD, ssh config import, record → ResolvedHost,
// and two connections ("windows") sharing one database file.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppDatabase } from '../src/storage/database';
import { ForwardRepository } from '../src/storage/forwardRepository';
import { HostRepository } from '../src/storage/hostRepository';
import { resolveRecord } from '../src/storage/hostResolver';
import { importOnFirstRun, importSshConfig } from '../src/storage/sshConfigImporter';

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

export async function storageTests() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshx-db-'));
  const dbFile = path.join(tmp, 'sub', 'sshx.db');
  const cfgFile = path.join(tmp, 'config');
  fs.writeFileSync(
    cfgFile,
    `
Host web
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/web_key
  LocalForward 8080 localhost:80
  LocalForward 127.0.0.1:5433 db.internal:5432
  RemoteForward 9000 localhost:3000
  DynamicForward 127.0.0.1:1080
  ForwardAgent yes
  ServerAliveInterval 30

Host bastion
  HostName bastion.example.com
  ProxyCommand sh -c "nc %h %p"

Host *
  StrictHostKeyChecking accept-new
`,
  );

  const db = await AppDatabase.open(dbFile);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(dbFile).mode & 0o777, 0o600, 'database file is private');
  const hosts = new HostRepository(db);
  const forwards = new ForwardRepository(db);

  // First run imports; second run is a no-op.
  assert.deepStrictEqual(await importOnFirstRun(hosts, cfgFile), { imported: 2, skipped: 0 });
  assert.strictEqual(await importOnFirstRun(hosts, cfgFile), undefined);
  assert.deepStrictEqual(await importSshConfig(hosts, cfgFile), { imported: 0, skipped: 2 });

  const web = (await hosts.findByAlias('web'))!;
  assert.strictEqual(web.hostname, '10.0.0.5');
  assert.strictEqual(web.port, 2222);
  assert.strictEqual(web.username, 'deploy');
  assert.strictEqual(web.identityFile, '~/.ssh/web_key');
  assert.strictEqual(web.source, 'ssh-config');
  assert.strictEqual(web.options['serveraliveinterval'], '30');
  assert.strictEqual(web.options['stricthostkeychecking'], 'accept-new');
  assert.ok(!('localforward' in web.options), 'forwards are not stored as options');

  assert.deepStrictEqual(
    (await forwards.listForHost(web.id)).map((f) => [f.kind, f.bindHost, f.bindPort, f.targetHost, f.targetPort]),
    [
      ['dynamic', '127.0.0.1', 1080, '', 0],
      ['local', '127.0.0.1', 5433, 'db.internal', 5432],
      ['local', '', 8080, 'localhost', 80],
      ['remote', '', 9000, 'localhost', 3000],
    ],
  );
  assert.strictEqual(resolveRecord(web).forwardAgent, true, 'ForwardAgent carried over as an option');

  // Record → ResolvedHost (tokens expanded at connect time, quotes kept).
  const bastion = resolveRecord((await hosts.findByAlias('bastion'))!, { password: 'pw' });
  assert.strictEqual(bastion.proxyCommand, 'sh -c "nc bastion.example.com 22"');
  assert.strictEqual(bastion.strictHostKeyChecking, 'accept-new');
  assert.strictEqual(bastion.secrets.password, 'pw');
  const webResolved = resolveRecord(web);
  assert.strictEqual(webResolved.identityFiles[0], path.join(os.homedir(), '.ssh/web_key'));
  assert.strictEqual(webResolved.serverAliveInterval, 30);

  // A second connection to the same file (another VS Code window) sees commits and is notified.
  const db2 = await AppDatabase.open(dbFile);
  const hosts2 = new HostRepository(db2);
  const forwards2 = new ForwardRepository(db2);
  let notified = 0;
  db2.onDidChange(() => notified++);
  await hosts.update(web.id, { ...web, port: 22, authMethod: 'password' });
  assert.strictEqual((await hosts2.findByAlias('web'))!.port, 22, 'other connection reads the commit');
  await waitFor(() => notified > 0);

  // Concurrent writes from both connections both land (no last-writer-wins).
  await Promise.all([
    hosts.insert({ ...web, alias: 'from-window-1', source: 'manual' }),
    hosts2.insert({ ...web, alias: 'from-window-2', source: 'manual' }),
    ...Array.from({ length: 10 }, (_, i) => forwards.insert({ hostId: web.id, kind: 'local', bindHost: '', bindPort: 10000 + i, targetHost: 'x', targetPort: 1, label: '', autoStart: false })),
  ]);
  const aliases = (await hosts2.list()).map((h) => h.alias);
  assert.ok(aliases.includes('from-window-1') && aliases.includes('from-window-2'), 'both windows\' writes persisted');
  assert.strictEqual((await forwards2.listForHost(web.id)).length, 14);

  // Failed transaction rolls back; unique alias enforced.
  await assert.rejects(hosts.insert({ ...web, alias: 'bastion', source: 'manual' }), /UNIQUE/);
  assert.strictEqual((await hosts.list()).length, 4);

  // Deleting a host cascades to its forwards; data survives reopen.
  await hosts2.delete(web.id);
  assert.strictEqual((await forwards.listForHost(web.id)).length, 0, 'forwards cascade-deleted');
  await db.close();
  await db2.close();
  const db3 = await AppDatabase.open(dbFile);
  assert.deepStrictEqual((await new HostRepository(db3).list()).map((h) => h.alias), ['bastion', 'from-window-1', 'from-window-2']);
  await db3.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok  storage: import, CRUD, two windows, rollback, cascade, persistence');
}
