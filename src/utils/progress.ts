import * as vscode from 'vscode';
import { formatSize } from './format';

export interface ByteProgressReporter {
  /** Add transferred bytes. */
  report(bytes: number): void;
  /** Set the expected total so a percentage can be shown. */
  setTotal(bytes: number): void;
}

/** Notification progress for byte transfers ("1.2 MB / 50 MB"). */
export function withByteProgress(title: string, task: (p: ByteProgressReporter) => Promise<void>) {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async (progress) => {
    let done = 0;
    let total = 0;
    let lastPct = 0;
    await task({
      report(bytes) {
        done += bytes;
        if (!total) return progress.report({ message: formatSize(done) });
        const pct = (done / total) * 100;
        progress.report({ increment: pct - lastPct, message: `${formatSize(done)} / ${formatSize(total)}` });
        lastPct = pct;
      },
      setTotal(bytes) {
        total = bytes;
      },
    });
  });
}
