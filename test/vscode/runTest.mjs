// End-to-end: runs the built extension inside a real VS Code (downloaded by @vscode/test-electron,
// or VSCODE_EXECUTABLE if set) against an in-process SSH server. Proves the native SQLite binary
// loads in VS Code's Electron on this platform.
import { runTests } from '@vscode/test-electron';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Server, utils } = require('ssh2');
const root = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'sshx-e2e-'));

// The test SFTP server is TypeScript; bundle it for this script.
buildSync({ entryPoints: [join(root, 'test/sftpServer.ts')], outfile: join(tmp, 'sftpServer.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['cpu-features', '*.node'], logLevel: 'error' });
const { serveSftp } = require(join(tmp, 'sftpServer.cjs'));
const sftpRoot = join(tmp, 'sftp-root');
mkdirSync(sftpRoot);

// Echo target reachable "from the server".
const echo = net.createServer((s) => s.pipe(s));
await new Promise((r) => echo.listen(0, '127.0.0.1', r));

// ssh2 returns a malformed Ed25519 pair about 1 in 256 times (see src/ssh/keygen.ts); retry until it parses.
const ed25519 = () => {
  for (;;) {
    const pair = utils.generateKeyPairSync('ed25519');
    if (!(utils.parseKey(pair.public) instanceof Error)) return pair;
  }
};

// SSH server: public-key auth for a generated key, direct-tcpip for -L forwards.
const user = ed25519();
const userPub = utils.parseKey(user.public);
const server = new Server({ hostKeys: [ed25519().private] }, (client) => {
  client.on('error', () => {});
  client.on('authentication', (ctx) => {
    const ok =
      ctx.method === 'publickey' &&
      ctx.key.algo === userPub.type &&
      ctx.key.data.equals(userPub.getPublicSSH()) &&
      (!ctx.signature || userPub.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true);
    ok ? ctx.accept() : ctx.reject(['publickey']);
  });
  client.on('ready', () => {
    client.on('tcpip', (accept, _reject, info) => {
      const ch = accept();
      const s = net.connect(info.destPort, info.destIP);
      ch.pipe(s).pipe(ch);
    });
    // Session tab: a shell that greets, and SFTP backed by sftpRoot.
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (a) => a?.());
      session.on('shell', (a) => a().write('e2e shell ready\r\n$ '));
      session.on('sftp', (a) => serveSftp(a(), sftpRoot));
    });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const keyFile = join(tmp, 'id_ed25519').replace(/\\/g, '/');
writeFileSync(keyFile, user.private, { mode: 0o600 });
const sshConfig = join(tmp, 'ssh_config');
writeFileSync(
  sshConfig,
  `Host e2e
  HostName 127.0.0.1
  Port ${server.address().port}
  User tester
  IdentityFile ${keyFile}
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile ${join(tmp, 'known_hosts').replace(/\\/g, '/')}
  LocalForward 0 127.0.0.1:${echo.address().port}
`,
);

const userData = join(tmp, 'ud');
mkdirSync(join(userData, 'User'), { recursive: true });
writeFileSync(
  join(userData, 'User', 'settings.json'),
  JSON.stringify({ 'sshxStudio.databasePath': join(tmp, 'db', 'sshx.db'), 'sshxStudio.configPath': sshConfig }),
);

let code = 1;
try {
  code = await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'test/vscode/suite.cjs'),
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    launchArgs: ['--user-data-dir', userData, '--extensions-dir', join(tmp, 'ext'), '--disable-workspace-trust', '--disable-extensions'],
    extensionTestsEnv: { SSHX_E2E_DB: join(tmp, 'db', 'sshx.db'), SSHX_E2E_SFTP_ROOT: sftpRoot, SSHX_E2E_TMP: tmp },
  });
} catch (e) {
  console.error(e);
} finally {
  server.close();
  echo.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
