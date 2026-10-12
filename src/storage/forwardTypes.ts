/**
 * -L local: listen here, connect from the server.
 * -R remote: listen on the server, connect from here.
 * -D dynamic: SOCKS proxy here; each client picks its destination, reached from the server.
 */
export type ForwardKind = 'local' | 'remote' | 'dynamic';

export interface ForwardSpec {
  kind: ForwardKind;
  /** Empty = loopback (127.0.0.1 for -L, server default for -R). */
  bindHost: string;
  bindPort: number;
  /** Unused ('' / 0) for dynamic forwards. */
  targetHost: string;
  targetPort: number;
}

export interface ForwardRecord extends ForwardSpec {
  id: number;
  hostId: number;
  label: string;
  autoStart: boolean;
  createdAt: number;
}

export type NewForward = Omit<ForwardRecord, 'id' | 'createdAt'>;
