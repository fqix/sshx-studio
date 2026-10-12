import { StringDecoder } from 'string_decoder';
import type { Client, ClientChannel, X11Options } from 'ssh2';
import type { ResolvedHost } from '../config/types';
import { createX11Forwarder } from '../x11';
import type { HostMessage } from '../../shared/protocol';
import { errorMessage } from '../utils/async';
import type { Logger } from '../utils/logger';
import { shellQuote } from '../utils/shell';
import { t } from '../i18n';

const TERM = 'xterm-256color';

/** Interactive shell channel bridged to the webview's xterm. */
export class TerminalChannel {
  private shell?: ClientChannel;
  private size = { cols: 80, rows: 24 };

  constructor(
    private readonly send: (m: HostMessage) => void,
    private readonly log: Logger,
  ) {}

  async open(client: Client, host: ResolvedHost) {
    const x11 = host.forwardX11 ? this.setUpX11(client) : undefined;
    try {
      this.shell = await new Promise<ClientChannel>((res, rej) =>
        client.shell({ term: TERM, ...this.size }, x11 ? { x11 } : {}, (e, s) => (e ? rej(e) : res(s))),
      );
    } catch (e) {
      this.log(`shell: ${errorMessage(e)}`);
      this.write(`\r\n\x1b[31m${t('Could not open shell: {0}', errorMessage(e))}\x1b[0m\r\n`);
      return;
    }
    this.log(`shell opened (${this.size.cols}x${this.size.rows})`);
    // Decoders keep multi-byte UTF-8 characters intact across chunk boundaries.
    const out = new StringDecoder('utf8');
    const err = new StringDecoder('utf8');
    this.shell.on('data', (d: Buffer) => this.write(out.write(d)));
    this.shell.stderr.on('data', (d: Buffer) => this.write(err.write(d)));
    this.shell.on('close', () => this.write(`\r\n\x1b[33m[${t('session closed')}]\x1b[0m\r\n`));
  }

  /** ForwardX11: returns the shell's x11 request options, or explains in the terminal why not. */
  private setUpX11(client: Client): X11Options | undefined {
    const forwarder = createX11Forwarder(this.log);
    if ('unavailable' in forwarder) {
      this.write(`\x1b[33m${forwarder.unavailable}\x1b[0m\r\n`);
      return undefined;
    }
    forwarder.attach(client);
    return forwarder.requestOptions;
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

  private write(data: string) {
    this.send({ type: 'term.data', data });
  }
}
