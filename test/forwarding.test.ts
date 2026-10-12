// -D SOCKS, agent forwarding and X11 forwarding (with cookie spoofing) against the test SSH server.
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as net from 'net';
import type { SshConfig } from '../src/config/sshConfig';
import { ForwardManager } from '../src/forward/forwardManager';
import { connect } from '../src/ssh/connect';
import type { HostResolver, Prompter } from '../src/ssh/types';
import { parseDisplay } from '../src/x11/display';
import { rewriteSetup, X11Forwarder } from '../src/x11/x11Forwarder';

/** State the test SSH server records / hooks it calls (wired up in e2e.ts). */
export interface ServerHooks {
  agentRequests: number;
  x11Requests: { cookie: string; screen: number }[];
  /** Called when a client opens a shell; the test opens X11 channels from here. */
  onShell?: (conn: any) => void;
}

const once = <T>(emitter: NodeJS.EventEmitter, event: string) => new Promise<T>((r) => emitter.once(event, r as any));
const readAll = (s: net.Socket | NodeJS.ReadableStream, ms = 2000) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    s.on('data', (d: Buffer) => chunks.push(d));
    const done = () => resolve(Buffer.concat(chunks));
    s.once('close', done);
    s.once('end', done);
    setTimeout(done, ms);
  });

/** Minimal X11 client setup packet (little endian) with an MIT-MAGIC-COOKIE-1. */
function x11Setup(cookie: Buffer, trailing = Buffer.alloc(0)): Buffer {
  const name = Buffer.from('MIT-MAGIC-COOKIE-1');
  const head = Buffer.alloc(12);
  head.write('l', 0, 'latin1');
  head.writeUInt16LE(11, 2);
  head.writeUInt16LE(0, 4);
  head.writeUInt16LE(name.length, 6);
  head.writeUInt16LE(cookie.length, 8);
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  return Buffer.concat([head, pad(name), pad(cookie), trailing]);
}

export async function forwardingTests(cfg: SshConfig, prompter: Prompter, hooks: ServerHooks, echoPort: number) {
  // ------------------------------------------------------------- -D SOCKS
  const manager = new ForwardManager(cfg, () => ({ prompter, onConnected: async () => {} }), () => {});
  const rec = { id: 99, hostId: 1, kind: 'dynamic' as const, bindHost: '', bindPort: 0, targetHost: '', targetPort: 0, label: '', autoStart: false, createdAt: 0 };
  await manager.start('direct', rec);
  const socksPort = manager.state(99).port!;

  const socks = async (handshake: (s: net.Socket) => Promise<void>) => {
    const s = net.connect(socksPort, '127.0.0.1');
    await once(s, 'connect');
    await handshake(s);
    s.write('ping');
    const got = await new Promise<string>((r) => s.once('data', (d) => r(d.toString())));
    s.destroy();
    return got;
  };
  const read = (s: net.Socket, n: number) =>
    new Promise<Buffer>((resolve) => {
      let buf = Buffer.alloc(0);
      const on = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length >= n) {
          s.off('data', on);
          if (buf.length > n) s.unshift(buf.subarray(n));
          resolve(buf.subarray(0, n));
        }
      };
      s.on('data', on);
    });
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(echoPort);

  // SOCKS5 with a hostname (resolved on the server side) and with IPv4.
  for (const [label, addr] of [
    ['domain', Buffer.concat([Buffer.from([0x03, 9]), Buffer.from('localhost')])],
    ['ipv4', Buffer.from([0x01, 127, 0, 0, 1])],
  ] as const) {
    const got = await socks(async (s) => {
      s.write(Buffer.from([0x05, 0x01, 0x00]));
      assert.deepStrictEqual([...(await read(s, 2))], [0x05, 0x00]);
      s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addr, portBuf]));
      assert.strictEqual((await read(s, 10))[1], 0x00, `SOCKS5 ${label} CONNECT succeeded`);
    });
    assert.strictEqual(got, 'ping');
  }
  // SOCKS4a (hostname) and SOCKS4 (IPv4).
  for (const [label, ip, host] of [
    ['4a', [0, 0, 0, 1], 'localhost'],
    ['4', [127, 0, 0, 1], ''],
  ] as const) {
    const got = await socks(async (s) => {
      s.write(Buffer.concat([Buffer.from([0x04, 0x01]), portBuf, Buffer.from(ip), Buffer.from('user\0'), host ? Buffer.from(host + '\0') : Buffer.alloc(0)]));
      assert.strictEqual((await read(s, 8))[1], 0x5a, `SOCKS${label} granted`);
    });
    assert.strictEqual(got, 'ping');
  }
  // Unreachable destination → SOCKS5 failure reply, not a hang.
  const refused = net.connect(socksPort, '127.0.0.1');
  await once(refused, 'connect');
  refused.write(Buffer.from([0x05, 0x01, 0x00]));
  await read(refused, 2);
  refused.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 1])); // port 1
  assert.notStrictEqual((await read(refused, 10))[1], 0x00, 'failure reported to SOCKS client');
  refused.destroy();
  await manager.stop(99);
  manager.dispose();
  console.log('ok  -D SOCKS5 (hostname, IPv4), SOCKS4a, SOCKS4, failure reply');

  // ------------------------------------------------------- agent forwarding
  const withHost = (patch: object): HostResolver => ({ resolve: (a) => ({ ...cfg.resolve(a), ...patch }) });
  const fakeAgent = process.platform === 'win32' ? '\\\\.\\pipe\\sshx-test-agent' : `/tmp/sshx-test-agent-${process.pid}.sock`;
  const agentServer = net.createServer(() => {});
  await new Promise<void>((r) => agentServer.listen(fakeAgent, r));
  const exec = async (resolver: HostResolver) => {
    const c = await connect(resolver, 'direct', prompter);
    await new Promise<void>((res, rej) => c.client.exec('true', (e, s) => (e ? rej(e) : s.on('close', () => res()).resume())));
    c.dispose();
  };
  const before = hooks.agentRequests;
  await exec(withHost({ forwardAgent: fakeAgent }));
  assert.strictEqual(hooks.agentRequests, before + 1, 'auth-agent requested when ForwardAgent is set');
  await exec(withHost({ forwardAgent: false }));
  assert.strictEqual(hooks.agentRequests, before + 1, 'no auth-agent request when ForwardAgent is off');
  const savedSock = process.env.SSH_AUTH_SOCK;
  delete process.env.SSH_AUTH_SOCK;
  await exec(withHost({ forwardAgent: true, identityAgent: undefined }));
  if (savedSock !== undefined) process.env.SSH_AUTH_SOCK = savedSock;
  if (process.platform !== 'win32') assert.strictEqual(hooks.agentRequests, before + 1, 'no request without an agent');
  agentServer.close();
  console.log('ok  agent forwarding requested only when enabled and an agent exists');

  // ----------------------------------------------------------------- X11
  assert.deepStrictEqual(parseDisplay(':0', 'linux'), { kind: 'unix', path: '/tmp/.X11-unix/X0', display: ':0', number: 0, screen: 0 });
  assert.deepStrictEqual(parseDisplay('localhost:10.2', 'linux'), { kind: 'tcp', host: 'localhost', port: 6010, display: 'localhost:10.2', number: 10, screen: 2 });
  assert.strictEqual((parseDisplay('/private/tmp/com.apple.launchd.x/org.xquartz:0', 'darwin') as { path: string }).path, '/private/tmp/com.apple.launchd.x/org.xquartz:0');
  assert.strictEqual(parseDisplay(undefined, 'linux'), undefined);
  assert.strictEqual(parseDisplay(undefined, 'win32')?.kind, 'tcp');
  const fake = crypto.randomBytes(16);
  assert.strictEqual(rewriteSetup(x11Setup(fake).subarray(0, 20), fake, undefined), 'incomplete');
  assert.strictEqual(rewriteSetup(x11Setup(crypto.randomBytes(16)), fake, undefined), 'rejected');
  const stripped = rewriteSetup(x11Setup(fake, Buffer.from('rest')), fake, undefined) as Buffer;
  assert.deepStrictEqual([stripped.readUInt16LE(6), stripped.readUInt16LE(8), stripped.subarray(12).toString()], [0, 0, 'rest']);

  // Fake local X server on 127.0.0.1:(6000+n).
  const xServer = net.createServer();
  let displayNumber = 0;
  for (let n = 40 + (process.pid % 50); ; n++) {
    try {
      await new Promise<void>((res, rej) => xServer.once('error', rej).listen(6000 + n, '127.0.0.1', () => res()));
      displayNumber = n;
      break;
    } catch {
      if (n > 200) throw new Error('no free X11 test port');
    }
  }
  const realCookie = crypto.randomBytes(16);
  const forwarder = new X11Forwarder(parseDisplay(`127.0.0.1:${displayNumber}.0`, process.platform)!, realCookie, () => {});
  const xConnections: Promise<Buffer>[] = [];
  xServer.on('connection', (s) => {
    xConnections.push(
      new Promise((resolve) => {
        s.once('data', (d) => {
          s.write('X-REPLY');
          resolve(d);
        });
        s.once('close', () => resolve(Buffer.alloc(0)));
      }),
    );
  });

  const results = new Promise<{ good: Buffer; bad: Buffer }>((resolve) => {
    hooks.onShell = (conn) => {
      const cookie = Buffer.from(hooks.x11Requests.at(-1)!.cookie, 'hex');
      conn.x11('127.0.0.1', 50000, (err: Error, good: any) => {
        assert.ifError(err);
        good.write(x11Setup(cookie, Buffer.from('HELLO')));
        readAll(good, 1000).then((goodReply) =>
          conn.x11('127.0.0.1', 50001, (err2: Error, bad: any) => {
            assert.ifError(err2);
            bad.write(x11Setup(crypto.randomBytes(16)));
            readAll(bad, 1000).then((badReply) => resolve({ good: goodReply, bad: badReply }));
          }),
        );
      });
    };
  });
  const c = await connect(cfg, 'direct', prompter);
  forwarder.attach(c.client);
  await new Promise<void>((res, rej) =>
    c.client.shell({ term: 'xterm' }, { x11: forwarder.requestOptions }, (e, s) => (e ? rej(e) : (s.resume(), res()))),
  );
  const { good, bad } = await results;
  const req = hooks.x11Requests.at(-1)!;
  assert.notStrictEqual(req.cookie, realCookie.toString('hex'), 'server never sees the real cookie');
  assert.strictEqual(good.toString(), 'X-REPLY', 'X server reply relayed back to the remote client');
  const received = await xConnections[0];
  const nameLen = received.readUInt16LE(6);
  const dataLen = received.readUInt16LE(8);
  const offset = 12 + ((nameLen + 3) & ~3);
  assert.ok(received.subarray(offset, offset + dataLen).equals(realCookie), 'local X server gets the real cookie');
  assert.strictEqual(received.subarray(offset + ((dataLen + 3) & ~3)).toString(), 'HELLO', 'data after setup preserved');
  assert.strictEqual(bad.length, 0, 'wrong cookie rejected');
  c.dispose();
  xServer.close();
  hooks.onShell = undefined;
  console.log('ok  X11 forwarding: fake cookie to server, real cookie to local display, wrong cookie rejected');
}
