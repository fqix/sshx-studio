import { ChildProcess, spawn } from 'child_process';
import { Duplex } from 'stream';
import { safe } from '../../utils/async';
import { t } from '../../i18n';

const STDERR_LIMIT = 4000;

/** Duplex stream over a spawned ProxyCommand's stdin/stdout, usable as ssh2's `sock`. */
export class ProxyCommandStream extends Duplex {
  private readonly proc: ChildProcess;
  /** Tail of the command's stderr, for error messages. */
  stderr = '';

  constructor(command: string) {
    super();
    this.proc =
      process.platform === 'win32'
        ? spawn(command, { shell: true, windowsHide: true })
        : spawn(process.env.SHELL || '/bin/sh', ['-c', `exec ${command}`]);

    this.proc.stdout!.on('data', (d: Buffer) => {
      if (!this.push(d)) this.proc.stdout!.pause();
    });
    this.proc.stdout!.on('end', () => this.push(null));
    this.proc.stderr!.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-STDERR_LIMIT);
    });
    this.proc.on('error', (e) => this.destroy(e));
    this.proc.on('exit', (code) => {
      if (code) this.destroy(new Error(t('ProxyCommand exited with code {0}: {1}', code, this.stderr.trim())));
    });
  }

  _read() {
    this.proc.stdout?.resume();
  }

  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void) {
    this.proc.stdin!.write(chunk, cb);
  }

  _final(cb: () => void) {
    this.proc.stdin!.end();
    cb();
  }

  _destroy(err: Error | null, cb: (e: Error | null) => void) {
    safe(() => this.proc.kill());
    cb(err);
  }
}
