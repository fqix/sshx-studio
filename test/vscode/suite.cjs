// Runs inside the VS Code extension host (see runTest.mjs).
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const vscode = require('vscode');

const roundTrip = (port, msg) =>
  new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(msg));
    s.once('data', (d) => (resolve(d.toString()), s.end()));
    s.once('error', reject);
    setTimeout(() => reject(new Error('no reply')), 10000);
  });

exports.run = async () => {
  const log = (m) => console.log(`[e2e] ${m}`);
  log(`VS Code ${vscode.version}, Electron ${process.versions.electron}, Node ${process.versions.node}, ${process.platform}-${process.arch}`);

  const ext = vscode.extensions.all.find((e) => e.id.endsWith('.sshx-studio'));
  assert.ok(ext, 'extension found');
  const api = await ext.activate(); // opens SQLite through the bundled native binary
  log('activated; native SQLite loaded');
  assert.ok(fs.existsSync(process.env.SSHX_E2E_DB), 'database file created');

  // First-run import from the fixture ssh config.
  const hosts = await api.hosts.list();
  assert.deepStrictEqual(hosts.map((h) => h.alias), ['e2e']);
  const forwards = await api.forwards.listForHost(hosts[0].id);
  assert.strictEqual(forwards.length, 1, 'LocalForward imported');
  log('ssh config imported (1 host, 1 forward)');

  // -L forward through the in-process SSH server (key auth, no prompts).
  await api.forwardManager.start('e2e', forwards[0]);
  const state = api.forwardManager.state(forwards[0].id);
  assert.strictEqual(state.status, 'active');
  assert.strictEqual(await roundTrip(state.port, 'ping'), 'ping');
  await api.forwardManager.stop(forwards[0].id);
  log('-L forward round-trip ok');

  // Session tab (webview + terminal + SFTP), then an upload the way the Explorer command does it.
  const session = api.sessions.findOrOpen('e2e');
  await session.whenFilesReady();
  assert.strictEqual(session.remoteDir, '/', 'file pane shows the remote home');
  log('session tab open, SFTP ready');
  const path = require('path');
  const local = path.join(process.env.SSHX_E2E_TMP, 'from-explorer');
  fs.mkdirSync(path.join(local, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(local, 'a.txt'), 'hello from the explorer');
  fs.writeFileSync(path.join(local, 'nested', 'b.bin'), Buffer.alloc(300 * 1024, 7));
  assert.strictEqual(api.sessions.findOrOpen('e2e'), session, 'reuses the open session');
  session.uploadLocal([local], '/');
  const uploaded = path.join(process.env.SSHX_E2E_SFTP_ROOT, 'from-explorer');
  for (let i = 0; i < 200 && !(fs.existsSync(path.join(uploaded, 'nested', 'b.bin')) && fs.statSync(path.join(uploaded, 'nested', 'b.bin')).size === 300 * 1024); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.strictEqual(fs.readFileSync(path.join(uploaded, 'a.txt'), 'utf8'), 'hello from the explorer');
  assert.strictEqual(fs.statSync(path.join(uploaded, 'nested', 'b.bin')).size, 300 * 1024);
  log('explorer-style folder upload landed on the server');
  session.dispose();

  // The command and its Explorer menu entry are registered.
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('sshxStudio.uploadFromExplorer'));
  const manifest = ext.packageJSON.contributes.menus['explorer/context'];
  assert.ok(manifest.some((m) => m.command === 'sshxStudio.uploadFromExplorer'), 'explorer/context menu entry');
  log('explorer upload command + menu registered');
};
