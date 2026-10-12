import * as crypto from 'crypto';
import type { Duplex } from 'stream';
import type { Client, X11Options } from 'ssh2';
import { connectDisplay, X11Display } from './display';

const MIT_MAGIC_COOKIE = 'MIT-MAGIC-COOKIE-1';
const pad4 = (n: number) => (n + 3) & ~3;

/**
 * X11 forwarding with cookie spoofing, like OpenSSH: the server gets a random fake cookie; when an
 * X client on the server connects, its setup packet's fake cookie is checked and replaced with the
 * real one (or stripped if the local display needs none). The real cookie never leaves this machine.
 */
export class X11Forwarder {
  private readonly fakeCookie = crypto.randomBytes(16);

  constructor(
    private readonly display: X11Display,
    /** Real cookie for the local display (`xauth list`), if it uses one. */
    private readonly realCookie: Buffer | undefined,
    private readonly log: (message: string) => void,
  ) {}

  /** Options for `client.shell(..., { x11 })`. */
  get requestOptions(): X11Options {
    return { single: false, screen: this.display.screen, protocol: MIT_MAGIC_COOKIE, cookie: this.fakeCookie };
  }

  /** Handle X11 channels the server opens on this connection. */
  attach(client: Client) {
    client.on('x11', (_info, accept, reject) => {
      const local = connectDisplay(this.display);
      local.once('error', (e) => {
        this.log(`X11: cannot reach display ${this.display.display}: ${e.message}`);
        reject();
      });
      local.once('connect', () => {
        local.removeAllListeners('error');
        const channel = accept();
        local.on('error', () => channel.close());
        channel.on('error', () => local.destroy());
        this.relay(channel, local);
      });
    });
  }

  /** Rewrite the X11 connection setup (client → server), then pipe both ways. */
  private relay(channel: Duplex, local: Duplex) {
    let pending = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      pending = Buffer.concat([pending, d]);
      const rewritten = rewriteSetup(pending, this.fakeCookie, this.realCookie);
      if (rewritten === 'incomplete') return;
      channel.off('data', onData);
      if (rewritten === 'rejected') {
        this.log('X11: rejected connection with a wrong authentication cookie');
        channel.destroy();
        local.destroy();
        return;
      }
      local.write(rewritten);
      channel.pipe(local);
      local.pipe(channel);
    };
    channel.on('data', onData);
  }
}

/**
 * X11 connection setup: byte-order(1) pad(1) major(2) minor(2) nameLen(2) dataLen(2) pad(2)
 * name(nameLen, padded to 4) data(dataLen, padded to 4) — followed by regular X11 traffic.
 */
export function rewriteSetup(buf: Buffer, fake: Buffer, real: Buffer | undefined): Buffer | 'incomplete' | 'rejected' {
  if (buf.length < 12) return 'incomplete';
  const le = buf[0] === 0x6c; // 'l' little endian, 'B' big endian
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const nameLen = u16(6);
  const dataLen = u16(8);
  const end = 12 + pad4(nameLen) + pad4(dataLen);
  if (buf.length < end) return 'incomplete';

  const name = buf.subarray(12, 12 + nameLen).toString('latin1');
  const data = buf.subarray(12 + pad4(nameLen), 12 + pad4(nameLen) + dataLen);
  if (name !== MIT_MAGIC_COOKIE || data.length !== fake.length || !crypto.timingSafeEqual(data, fake)) return 'rejected';

  const header = Buffer.from(buf.subarray(0, 12));
  const write16 = (o: number, v: number) => (le ? header.writeUInt16LE(v, o) : header.writeUInt16BE(v, o));
  const rest = buf.subarray(end);
  if (!real) {
    write16(6, 0);
    write16(8, 0);
    return Buffer.concat([header, rest]);
  }
  write16(6, nameLen);
  write16(8, real.length);
  const namePadded = Buffer.alloc(pad4(nameLen));
  namePadded.write(MIT_MAGIC_COOKIE, 'latin1');
  const dataPadded = Buffer.alloc(pad4(real.length));
  real.copy(dataPadded);
  return Buffer.concat([header, namePadded, dataPadded, rest]);
}
