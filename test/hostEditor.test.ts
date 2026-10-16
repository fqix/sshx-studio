// "Test connection" from the host editor: uses the form's unsaved values and writes nothing.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { HostDraft } from '../shared/protocol';
import type { SshConfig } from '../src/config/sshConfig';
import { testConnection } from '../src/hosts/connectionTester';
import { emptyDraft, HostService, ValidationError } from '../src/hosts/hostService';
import type { Prompter } from '../src/ssh/types';
import { AppDatabase } from '../src/storage/database';
import { GroupRepository } from '../src/storage/groupRepository';
import { HostRepository } from '../src/storage/hostRepository';
import { HostSecretStore, SecretBackend } from '../src/storage/secretStore';

export async function hostEditorTests(cfg: SshConfig, port: number, prompter: Prompter) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshx-editor-'));
  const db = await AppDatabase.open(path.join(tmp, 'sshx.db'));
  const hosts = new HostRepository(db);
  const stored = new Map<string, string>();
  const backend: SecretBackend = {
    get: async (k) => stored.get(k),
    store: async (k, v) => void stored.set(k, v),
    delete: async (k) => void stored.delete(k),
  };
  const groups = new GroupRepository(db);
  const service = new HostService(hosts, new HostSecretStore(backend), groups);
  const knownHosts = cfg.resolve('direct').knownHostsFile;

  const draft = (patch: Partial<HostDraft>): HostDraft => ({ ...emptyDraft(), hostname: '127.0.0.1', port, username: 'u', ...patch });
  const noPrompt: Prompter = { ...prompter, password: async () => undefined };
  // Unsaved test host still uses the user's known_hosts settings via options; point it at the test file.
  const preview = async (d: HostDraft) => ({ ...(await service.previewHost(d)), knownHostsFile: knownHosts, strictHostKeyChecking: 'no' });

  // No name needed to test; typed (unsaved) password is used without prompting.
  const ok = await testConnection(await preview(draft({ authMethod: 'password', password: 'pw' })), cfg, noPrompt);
  assert.ok(ok.ok, ok.message);
  assert.match(ok.message, /u@127\.0\.0\.1/);
  assert.ok(ok.details.some((d) => d.startsWith('SFTP available')), ok.details.join('; '));

  // Wrong password: a clean failure, not a hang or a throw.
  const bad = await testConnection(await preview(draft({ authMethod: 'password', password: 'nope' })), cfg, noPrompt);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /^Connection failed/);

  // Testing writes nothing; saving still validates the name.
  assert.strictEqual((await hosts.list()).length, 0, 'no host saved by testing');
  assert.strictEqual(stored.size, 0, 'no secret saved by testing');
  await assert.rejects(service.save(draft({ authMethod: 'password', password: 'pw' })), (e: unknown) => e instanceof ValidationError && e.field === 'alias');

  // Editing a saved host: blank password field means "use the saved one".
  const saved = await service.save(draft({ alias: 'saved', authMethod: 'password', password: 'pw' }));
  const again = await testConnection(await preview(draft({ id: saved.id, alias: 'saved', authMethod: 'password', password: '' })), cfg, noPrompt);
  assert.ok(again.ok, again.message);

  // Group: a new host from a group's menu starts there; the choice is saved; a vanished group is refused.
  const team = await groups.insert('Team', null);
  const fresh = await service.editorState(undefined, team.id);
  assert.strictEqual(fresh.draft.groupId, team.id);
  assert.deepStrictEqual(fresh.groups, [{ id: team.id, path: 'Team' }]);
  const grouped = await service.save(draft({ alias: 'grouped', groupId: team.id }));
  assert.strictEqual(grouped.groupId, team.id);
  assert.strictEqual((await service.editorState(grouped.id)).draft.groupId, team.id);
  await assert.rejects(service.save(draft({ alias: 'orphan', groupId: 9999 })), (e: unknown) => e instanceof ValidationError && e.field === 'groupId');

  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok  test connection: unsaved values used, failures reported, nothing written');
}
