import * as net from 'net';

/** Destination requested by a SOCKS client. Hostnames are resolved on the SSH server, like ssh -D. */
export interface SocksRequest {
  host: string;
  port: number;
  /** Tell the client whether the tunnel opened, then (on success) hand over the socket. */
  reply(ok: boolean): void;
}

/** Reads exactly-sized chunks from a socket that may deliver them in arbitrary pieces. */
class Reader {
  private buf = Buffer.alloc(0);
  private waiting?: () => void;
  private closed = false;

  constructor(private readonly sock: net.Socket) {
    sock.on('data', this.onData);
    sock.once('close', this.onClose);
  }

  private readonly onData = (d: Buffer) => {
    this.buf = Buffer.concat([this.buf, d]);
    this.waiting?.();
  };

  private readonly onClose = () => {
    this.closed = true;
    this.waiting?.();
  };

  /** Wait for more data; throws if the client went away mid-handshake. */
  private async more() {
    if (this.closed) throw new Error('SOCKS client closed the connection');
    await new Promise<void>((r) => (this.waiting = r));
    if (this.closed && !this.buf.length) throw new Error('SOCKS client closed the connection');
  }

  async bytes(n: number): Promise<Buffer> {
    while (this.buf.length < n) await this.more();
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** Bytes up to (not including) a NUL terminator. */
  async cstring(max = 255): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(0);
      if (i >= 0) {
        const s = this.buf.subarray(0, i).toString('latin1');
        this.buf = this.buf.subarray(i + 1);
        return s;
      }
      if (this.buf.length > max) throw new Error('SOCKS string too long');
      await this.more();
    }
  }

  /** Stop reading; return anything received past the handshake (sent on to the tunnel). */
  release(): Buffer {
    this.sock.off('data', this.onData);
    this.sock.off('close', this.onClose);
    return this.buf;
  }
}

const V5 = 0x05;
const V4 = 0x04;
const CMD_CONNECT = 0x01;

/**
 * Handle one SOCKS5 or SOCKS4/4a handshake (no authentication, CONNECT only).
 * Resolves with the destination and any data the client already sent after the request.
 */
export async function socksHandshake(sock: net.Socket): Promise<SocksRequest & { early: Buffer }> {
  const r = new Reader(sock);
  const [version] = await r.bytes(1);

  if (version === V5) {
    const [nMethods] = await r.bytes(1);
    const methods = await r.bytes(nMethods);
    if (!methods.includes(0x00)) {
      sock.end(Buffer.from([V5, 0xff]));
      throw new Error('SOCKS5 client requires authentication');
    }
    sock.write(Buffer.from([V5, 0x00]));
    const [, cmd, , atyp] = await r.bytes(4);
    let host: string;
    if (atyp === 0x01) host = [...(await r.bytes(4))].join('.');
    else if (atyp === 0x03) host = (await r.bytes((await r.bytes(1))[0])).toString('latin1');
    else if (atyp === 0x04) host = ipv6(await r.bytes(16));
    else throw fail5(sock, 0x08, `unsupported address type ${atyp}`);
    const port = (await r.bytes(2)).readUInt16BE(0);
    if (cmd !== CMD_CONNECT) throw fail5(sock, 0x07, `unsupported SOCKS5 command ${cmd}`);
    return {
      host,
      port,
      early: r.release(),
      // BND.ADDR/PORT are not meaningful for a tunnel; report 0.0.0.0:0 like OpenSSH.
      reply: (ok) => sock.write(Buffer.from([V5, ok ? 0x00 : 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])),
    };
  }

  if (version === V4) {
    const [cmd] = await r.bytes(1);
    const port = (await r.bytes(2)).readUInt16BE(0);
    const ip = await r.bytes(4);
    await r.cstring(); // user id, ignored
    // SOCKS4a: 0.0.0.x (x != 0) means "hostname follows".
    const host = ip[0] === 0 && ip[1] === 0 && ip[2] === 0 && ip[3] !== 0 ? await r.cstring() : [...ip].join('.');
    const reply = (ok: boolean) => sock.write(Buffer.from([0x00, ok ? 0x5a : 0x5b, 0, 0, 0, 0, 0, 0]));
    if (cmd !== CMD_CONNECT) {
      reply(false);
      sock.end();
      throw new Error(`unsupported SOCKS4 command ${cmd}`);
    }
    return { host, port, early: r.release(), reply };
  }

  sock.destroy();
  throw new Error(`not a SOCKS request (version byte ${version})`);
}

function fail5(sock: net.Socket, code: number, message: string): Error {
  sock.end(Buffer.from([V5, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
  return new Error(message);
}

function ipv6(b: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16));
  return groups.join(':');
}
