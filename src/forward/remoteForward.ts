import * as net from 'net';
import type { Client, TcpConnectionDetails } from 'ssh2';
import type { ForwardSpec } from '../storage/forwardTypes';
import type { RunningForward } from './localForward';

type Target = { host: string; port: number };

/**
 * ssh -R needs one 'tcp connection' listener per client that dispatches incoming
 * channels to the right local target by the remote port they arrived on.
 */
const routers = new WeakMap<Client, Map<number, Target>>();

function routerFor(client: Client): Map<number, Target> {
  let routes = routers.get(client);
  if (routes) return routes;
  const table = new Map<number, Target>();
  routers.set(client, table);
  client.on('tcp connection', (info: TcpConnectionDetails, accept, reject) => {
    const target = table.get(info.destPort);
    if (!target) return reject();
    const channel = accept();
    const sock = net.connect(target.port, target.host);
    sock.on('error', () => channel.close());
    channel.on('error', () => sock.destroy());
    channel.pipe(sock).pipe(channel);
  });
  return table;
}

/** ssh -R: the server listens on bindHost:bindPort; connections are tunnelled back to targetHost:targetPort here. */
export function startRemoteForward(client: Client, spec: ForwardSpec): Promise<RunningForward> {
  const bindAddr = spec.bindHost || 'localhost';
  return new Promise((resolve, reject) => {
    client.forwardIn(bindAddr, spec.bindPort, (err, port) => {
      if (err) return reject(err);
      const bound = port || spec.bindPort;
      routerFor(client).set(bound, { host: spec.targetHost, port: spec.targetPort });
      resolve({
        port: bound,
        close: () =>
          new Promise<void>((done) => {
            routerFor(client).delete(bound);
            client.unforwardIn(bindAddr, bound, () => done());
          }),
      });
    });
  });
}
