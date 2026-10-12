import { useState } from 'react';
import type { TransferItem } from '@shared/protocol';
import { vscode } from '../vscode/api';
import { useHostMessage } from './useHostMessage';

/** Upload/download list pushed by the extension's TransferQueue. */
export function useTransfers() {
  const [items, setItems] = useState<TransferItem[]>([]);
  useHostMessage((m) => {
    if (m.type === 'transfer.update') setItems(m.items);
  });
  return {
    items,
    active: items.filter((i) => i.status === 'queued' || i.status === 'running').length,
    cancel: (id: number) => vscode.postMessage({ type: 'transfer.cancel', id }),
    reveal: (id: number) => vscode.postMessage({ type: 'transfer.reveal', id }),
    clearFinished: () => vscode.postMessage({ type: 'transfer.clearFinished' }),
  };
}
