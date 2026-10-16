import { StringDecoder } from 'string_decoder';
import type { Client, ClientChannel, X11Options } from 'ssh2';
import { createX11Forwarder } from '../x11';
import type { HostMessage } from '../../shared/protocol';
import { errorMessage } from '../utils/async';
import type { Logger } from '../utils/logger';
import { shellQuote } from '../utils/shell';
import { t } from '../i18n';

const TERM = 'xterm-256color';

/** ForwardX11 for one connection: the request every shell sends, or why forwarding is unavailable. */
export interface X11Setup {
  request?: X11Options;
  notice?: string;
}

/**
 * Set up X11 forwarding once per connection. All shells on the connection share the forwarder,
 * so incoming X11 channels are accepted by exactly one handler.
 */
export function setUpX11(client: Client, log: Logger): X11Setup {
  const forwarder = createX11Forwarder(log);
  if ('unavailable' in forwarder) return { notice: forwarder.unavailable };
  forwarder.attach(client);
  return { request: forwarder.requestOptions };
}

/** One interactive shell channel bridged to one xterm in the webview (a session tab can have several). */
export class TerminalChannel {
  private shell?: ClientChannel;
  private size = { cols: 80, rows: 24 };

  constructor(
    readonly id: number,
    private readonly send: (m: HostMessage) => void,
    private readonly log: Logger,
  ) {}

  async open(client: Client, x11?: X11Setup) {
    if (x11?.notice) this.write(`\x1b[33m${x11.notice}\x1b[0m\r\n`);
    let shell: ClientChannel;
    try {
      shell = await new Promise<ClientChannel>((res, rej) =>
        client.shell({ term: TERM, ...this.size }, x11?.request ? { x11: x11.request } : {}, (e, s) => (e ? rej(e) : res(s))),
      );
    } catch (e) {
      this.log(`shell ${this.id}: ${errorMessage(e)}`);
      this.write(`\r\n\x1b[31m${t('Could not open shell: {0}', errorMessage(e))}\x1b[0m\r\n`);
      return;
    }
    this.shell = shell;
    this.log(`shell ${this.id} opened (${this.size.cols}x${this.size.rows})`);
    // Decoders keep multi-byte UTF-8 characters intact across chunk boundaries.
    const out = new StringDecoder('utf8');
    const err = new StringDecoder('utf8');
    shell.on('data', (d: Buffer) => this.write(out.write(d)));
    shell.stderr.on('data', (d: Buffer) => this.write(err.write(d)));
    shell.on('close', () => {
      if (this.shell === shell) this.write(`\r\n\x1b[33m[${t('session closed')}]\x1b[0m\r\n`);
    });
  }

  resize(cols: number, rows: number) {
    this.size = { cols, rows };
    this.shell?.setWindow(rows, cols, 0, 0);
  }

  input(data: string) {
    this.shell?.write(data);
  }

  cd(path: string) {
    this.input(`cd ${shellQuote(path)}\r`);
  }

  detach() {
    this.shell = undefined;
  }

  /** The terminal was closed in the webview: end its shell, leaving the connection up. */
  close() {
    const shell = this.shell;
    this.shell = undefined;
    shell?.close();
  }

  private write(data: string) {
    this.send({ type: 'term.data', term: this.id, data });
  }
}
