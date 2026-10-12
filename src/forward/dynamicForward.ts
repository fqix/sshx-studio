import * as net from 'net';
import type { Client } from 'ssh2';
import type { ForwardSpec } from '../storage/forwardTypes';
import type { RunningForward } from './localForward';
import { socksHandshake } from './socks';

/** ssh -D: a local SOCKS5/4a proxy; each requested destination is reached from the SSH server. */
export function startDynamicForward(client: Client, spec: ForwardSpec): Promise<RunningForward> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sock.destroy());
    socksHandshake(sock).then(
      (req) =>
        client.forwardOut(sock.remoteAddress ?? '127.0.0.1', sock.remotePort ?? 0, req.host, req.port, (err, channel) => {
          req.reply(!err);
          if (err) return sock.end();
          channel.on('error', () => sock.destroy());
          if (req.early.length) channel.write(req.early);
          sock.pipe(channel).pipe(sock);
        }),
      () => sock.destroy(),
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(spec.bindPort, spec.bindHost || '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            sockets.forEach((s) => s.destroy());
            server.close(() => done());
          }),
      });
    });
  });
}
