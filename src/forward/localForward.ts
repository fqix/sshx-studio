import * as net from 'net';
import type { Client } from 'ssh2';
import type { ForwardSpec } from '../storage/forwardTypes';

export interface RunningForward {
  /** Port actually bound (differs from the spec when it asked for 0). */
  port: number;
  close(): Promise<void>;
}

/** ssh -L: listen locally; each connection is tunnelled to targetHost:targetPort from the server side. */
export function startLocalForward(client: Client, spec: ForwardSpec): Promise<RunningForward> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sock.destroy());
    client.forwardOut(sock.remoteAddress ?? '127.0.0.1', sock.remotePort ?? 0, spec.targetHost, spec.targetPort, (err, channel) => {
      if (err) return sock.destroy();
      channel.on('error', () => sock.destroy());
      sock.pipe(channel).pipe(sock);
    });
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
