// End-to-end check of config parsing + ProxyCommand + ProxyJump against an in-process ssh2 server.
// Run: npm test
import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { Server, utils } from 'ssh2';
import { SshConfig } from '../src/config/sshConfig';
import { ForwardManager } from '../src/forward/forwardManager';
import { connect } from '../src/ssh/connect';
import { generateKeyPair, inspectPrivateKey } from '../src/ssh/keygen';
import type { HostResolver, Prompter } from '../src/ssh/types';
import type { ForwardRecord } from '../src/storage/forwardTypes';
import { serveSftp } from './sftpServer';
import { forwardingTests, ServerHooks } from './forwarding.test';
import { hostEditorTests } from './hostEditor.test';
import { storageTests } from './storage.test';
import { transferTests } from './transfers.test';

/** TCP echo server on a random local port. */
async function echoServer(): Promise<net.Server> {
  const srv = net.createServer((s) => s.pipe(s));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return srv;
}

/** Connect, send `msg`, return what comes back. */
function roundTrip(port: number, msg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(msg));
    s.once('data', (d) => (resolve(d.toString()), s.end()));
    s.once('error', reject);
  });
}

const portOf = (s: net.Server) => (s.address() as net.AddressInfo).port;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshx-test-'));
  const kh = path.join(tmp, 'known_hosts');
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const sftpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sshx-sftp-root-'));
  const hooks: ServerHooks = { agentRequests: 0, x11Requests: [] };
  const userKey = generateKeyPair('ed25519', 'test@sshx', 'secret-pass');
  const userPub = utils.parseKey(userKey.publicKey) as any;
  let directTcpip = 0;

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'pw') return ctx.accept();
      if (
        ctx.method === 'publickey' &&
        ctx.username === 'k' &&
        ctx.key.algo === userPub.type &&
        ctx.key.data.equals(userPub.getPublicSSH()) &&
        (!ctx.signature || userPub.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)
      )
        return ctx.accept();
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => {
      // ssh -R support: listen on the requested port and open forwarded-tcpip channels back.
      const listeners = new Map<number, net.Server>();
      client.on('request', (accept, reject, name, info: any) => {
        if (name === 'tcpip-forward') {
          const srv = net.createServer((sock) => {
            client.forwardOut(info.bindAddr, port, sock.remoteAddress!, sock.remotePort!, (err, ch) => {
              if (err) return sock.destroy();
              sock.pipe(ch).pipe(sock);
            });
          });
          let port = 0;
          srv.listen(info.bindPort, '127.0.0.1', () => {
            port = (srv.address() as net.AddressInfo).port;
            listeners.set(port, srv);
            accept?.(port);
          });
        } else if (name === 'cancel-tcpip-forward') {
          listeners.get(info.bindPort)?.close();
          listeners.delete(info.bindPort);
          accept?.();
        } else reject?.();
      });
      client.on('close', () => listeners.forEach((l) => l.close()));
      // Like sshd: open the channel only if the destination is reachable, otherwise reject it.
      client.on('tcpip', (accept, reject, info) => {
        directTcpip++;
        const s = net.connect(info.destPort, info.destIP);
        s.once('error', () => reject());
        s.once('connect', () => {
          const ch = accept();
          ch.on('error', () => s.destroy());
          s.on('error', () => ch.close());
          ch.pipe(s).pipe(ch);
        });
      });
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => serveSftp(acceptSftp(), sftpRoot));
        session.on('auth-agent', (acceptAgent) => {
          hooks.agentRequests++;
          acceptAgent?.();
        });
        session.on('x11', (acceptX11, _rejectX11, info) => {
          // ssh2 delivers the hex cookie as a Buffer of ASCII hex digits (its typings say string).
          const cookie = Buffer.isBuffer(info.cookie) ? (info.cookie as Buffer).toString('latin1') : info.cookie;
          hooks.x11Requests.push({ cookie, screen: info.screen });
          acceptX11?.();
        });
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('shell', (acceptShell) => {
          acceptShell();
          hooks.onShell?.(client);
        });
        session.on('exec', (acc, _rej, info) => {
          const st = acc();
          st.write(`ran:${info.command}`);
          st.exit(0);
          st.end();
        });
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;

  const cfgPath = path.join(tmp, 'config');
  // `node <pipe> %h %p` instead of `nc` so the ProxyCommand tests also run on Windows CI.
  const pipe = path.resolve(__dirname, '../test/fixtures/tcp-pipe.js').replace(/\\/g, '/');
  const node = process.execPath.replace(/\\/g, '/');
  fs.writeFileSync(
    cfgPath,
    `
Host direct jump
  HostName 127.0.0.1
  Port ${port}

Host viacmd
  HostName 127.0.0.1
  Port ${port}
  ProxyCommand "${node}" ${pipe} %h %p

Host viaquoted
  HostName 127.0.0.1
  Port ${port}
  ProxyCommand "${node}" "${pipe}" %h %p

Host viajump
  HostName 127.0.0.1
  Port ${port}
  ProxyJump jump

Host *.wild !nope
  User wild

Host *
  User u
  IdentitiesOnly yes
  IdentityFile ${tmp}/none
  UserKnownHostsFile ${kh}
`,
  );

  const cfg = new SshConfig(cfgPath);
  assert.deepStrictEqual(cfg.listHosts(), ['direct', 'jump', 'viacmd', 'viaquoted', 'viajump']);
  assert.strictEqual(cfg.resolve('viaquoted').proxyCommand, `"${node}" "${pipe}" 127.0.0.1 ${port}`, 'quotes preserved');
  assert.strictEqual(cfg.resolve('viacmd').proxyCommand, `"${node}" ${pipe} 127.0.0.1 ${port}`);
  assert.strictEqual(cfg.resolve('a.wild').user, 'wild');
  assert.strictEqual(cfg.resolve('direct').user, 'u');

  let hostKeyPrompts = 0;
  const prompter: Prompter = {
    password: async () => 'pw',
    passphrase: async () => undefined,
    confirmHostKey: async () => (hostKeyPrompts++, true),
    log: () => {},
  };

  for (const alias of ['direct', 'viacmd', 'viaquoted', 'viajump']) {
    const c = await connect(cfg, alias, prompter);
    const out = await new Promise<string>((res, rej) =>
      c.client.exec('hello', (e, s) => {
        if (e) return rej(e);
        let buf = '';
        s.on('data', (d: Buffer) => (buf += d)).on('close', () => res(buf));
      }),
    );
    assert.strictEqual(out, 'ran:hello');
    c.dispose();
    console.log(`ok  ${alias}`);
  }
  assert.strictEqual(hostKeyPrompts, 1, 'host key should be trusted after first prompt');
  assert.strictEqual(directTcpip, 1, 'ProxyJump should use direct-tcpip');

  // Changed host key must be rejected.
  const otherKey = utils.parseKey(utils.generateKeyPairSync('ed25519').public) as any;
  const forged = otherKey.getPublicSSH().toString('base64');
  fs.writeFileSync(kh, fs.readFileSync(kh, 'utf8').replace(/ssh-ed25519 \S+/, `ssh-ed25519 ${forged}`));
  await assert.rejects(connect(cfg, 'direct', prompter));
  console.log('ok  host key mismatch rejected');

  // Restore a trusted known_hosts for the remaining tests.
  fs.writeFileSync(kh, '');

  // Saved password: no prompt at all.
  const noPrompt: Prompter = { ...prompter, password: async () => assert.fail('should not prompt for password') };
  const savedPw: HostResolver = { resolve: (a) => ({ ...cfg.resolve(a), authMethod: 'password', secrets: { password: 'pw' } }) };
  (await connect(savedPw, 'direct', noPrompt)).dispose();
  console.log('ok  saved password used without prompting');

  // Stored (generated, encrypted) private key with saved passphrase.
  assert.deepStrictEqual(inspectPrivateKey(userKey.privateKey).ok, false);
  const inspected = inspectPrivateKey(userKey.privateKey, 'secret-pass', 'test@sshx');
  assert.ok(inspected.ok && inspected.publicKey === userKey.publicKey, 'derived public key matches');
  const storedKey: HostResolver = {
    resolve: (a) => ({ ...cfg.resolve(a), user: 'k', authMethod: 'keyStored', secrets: { privateKey: userKey.privateKey, passphrase: 'secret-pass' } }),
  };
  (await connect(storedKey, 'direct', noPrompt)).dispose();
  console.log('ok  stored private key + passphrase');

  // Unreachable agent (stale SSH_AUTH_SOCK) and forwarding to it: skipped, falls back to password.
  const logs: string[] = [];
  const logging: Prompter = { ...prompter, log: (m) => logs.push(m) };
  const deadAgent = path.join(tmp, 'no-agent.sock');
  const staleAgent: HostResolver = {
    resolve: (a) => ({ ...cfg.resolve(a), identitiesOnly: false, identityAgent: deadAgent, forwardAgent: true }),
  };
  (await connect(staleAgent, 'direct', logging)).dispose();
  assert.ok(logs.some((l) => l.includes('SSH agent unavailable')), 'agent error is logged, not fatal');
  assert.ok(logs.includes('[direct] Trying SSH agent keys'));
  assert.ok(logs.includes('[direct] Trying password'), 'falls back to password after the agent');
  assert.ok(!logs.includes('[direct] Server rejected SSH agent keys'), 'agent never reached the server');
  assert.ok(logs.includes('[direct] Server rejected keyboard-interactive; server allows: password, publickey'));
  console.log('ok  unreachable agent skipped');

  // Cancelling the password prompt aborts and is not reported as running out of methods.
  logs.length = 0;
  const cancel: Prompter = { ...logging, password: async () => undefined };
  await assert.rejects(connect(cfg, 'direct', cancel));
  assert.ok(!logs.some((l) => l.includes('No compatible authentication methods remain')));
  console.log('ok  password prompt cancel');

  // Port forwards: -L and -R through one shared connection.
  const echo = await echoServer();
  const forwards = new ForwardManager(cfg, () => ({ prompter, onConnected: async () => {} }), () => {});
  const fwd = (id: number, kind: 'local' | 'remote', targetPort: number): ForwardRecord => ({
    id, hostId: 1, kind, bindHost: '', bindPort: 0, targetHost: '127.0.0.1', targetPort, label: '', autoStart: false, createdAt: 0,
  });
  await forwards.start('viajump', fwd(1, 'local', portOf(echo)));
  const lPort = forwards.state(1).port!;
  assert.strictEqual(await roundTrip(lPort, 'via -L'), 'via -L');
  console.log('ok  -L forward (through ProxyJump)');

  await forwards.start('viajump', fwd(2, 'remote', portOf(echo)));
  const rPort = forwards.state(2).port!;
  assert.ok(rPort > 0);
  assert.strictEqual(await roundTrip(rPort, 'via -R'), 'via -R');
  console.log('ok  -R forward');

  await forwards.stop(1);
  assert.strictEqual(forwards.state(1).status, 'stopped');
  assert.strictEqual(forwards.state(2).status, 'active', 'other forward on the shared connection keeps running');
  await assert.rejects(roundTrip(lPort, 'x'));
  await forwards.stop(2);
  console.log('ok  stopping forwards');
  forwards.dispose();

  await forwardingTests(cfg, prompter, hooks, portOf(echo));
  await hostEditorTests(cfg, port, prompter);

  const sftpConn = await connect(cfg, 'direct', prompter);
  await transferTests(sftpConn.client, sftpRoot);
  sftpConn.dispose();
  fs.rmSync(sftpRoot, { recursive: true, force: true });

  await storageTests();
  echo.close();

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('all passed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
