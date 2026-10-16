import { useEffect, useState } from 'react';
import type { TransferItem } from '@shared/protocol';
import { useTransfers } from '../../hooks/useTransfers';
import { t } from '../../i18n';
import { formatSize } from '../../utils/format';
import { IconButton } from '../common/IconButton';
import './TransferPanel.css';

/** Per-transfer progress bars at the bottom of the file pane. */
export function TransferPanel() {
  const { items, active, cancel, pause, resume, reveal, clearFinished } = useTransfers();
  const [open, setOpen] = useState(true);
  // Re-open when new work arrives.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  if (!items.length) return null;

  return (
    <section className="transfers" aria-label={t('transfers.title')}>
      <header className="transfers-header">
        <button type="button" className="transfers-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden="true" />
          {t('transfers.title')}
          {active > 0 && <span className="transfers-badge">{active}</span>}
        </button>
        <IconButton icon="clear-all" label={t('transfers.clearFinished')} onClick={clearFinished} disabled={items.length === active} />
      </header>
      {open && (
        <ul className="transfers-list">
          {items.map((item) => (
            <TransferRow key={item.id} item={item} onCancel={() => cancel(item.id)} onPause={() => pause(item.id)} onResume={() => resume(item.id)} onReveal={() => reveal(item.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RowProps {
  item: TransferItem;
  onCancel(): void;
  onPause(): void;
  onResume(): void;
  onReveal(): void;
}

function TransferRow({ item, onCancel, onPause, onResume, onReveal }: RowProps) {
  const pct = item.totalBytes > 0 ? Math.min(100, (item.doneBytes / item.totalBytes) * 100) : item.status === 'done' ? 100 : 0;
  const busy = item.status === 'queued' || item.status === 'running';
  return (
    <li className={`transfer ${item.status}`}>
      <div className="transfer-line">
        <i className={`codicon codicon-${item.direction === 'upload' ? 'arrow-up' : 'arrow-down'}`} aria-hidden="true" />
        <span className="transfer-name" title={item.name}>
          {item.name}
        </span>
        <span className="transfer-status">{statusText(item, pct)}</span>
        {busy && <IconButton icon="debug-pause" label={t('transfers.pause')} onClick={onPause} />}
        {item.canResume && <IconButton icon="debug-continue" label={t('transfers.resume')} onClick={onResume} />}
        {(busy || item.canResume) && <IconButton icon="close" label={item.canResume ? t('transfers.discard') : t('transfers.cancel')} onClick={onCancel} />}
        {item.canReveal && <IconButton icon="folder-opened" label={t('transfers.reveal')} onClick={onReveal} />}
      </div>
      {(item.status === 'running' || item.status === 'queued') && (
        <div
          className={'transfer-bar' + (item.status === 'queued' || !item.totalBytes ? ' indeterminate' : '')}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="transfer-detail">{detailText(item)}</div>
    </li>
  );
}

function statusText(item: TransferItem, pct: number): string {
  switch (item.status) {
    case 'queued':
      return t('transfers.queued');
    case 'running':
      return item.totalBytes ? `${Math.floor(pct)}%` : t('transfers.scanning');
    case 'done':
      return t('transfers.done');
    case 'cancelled':
      return t('transfers.cancelled');
    case 'paused':
      return item.totalBytes ? `${t('transfers.paused')} · ${Math.floor(pct)}%` : t('transfers.paused');
    case 'error':
      return t('transfers.failed');
  }
}

function detailText(item: TransferItem): string {
  if (item.status === 'error') return item.canResume ? `${item.error ?? ''} · ${t('transfers.canResume')}` : item.error ?? '';
  const parts: string[] = [];
  if (item.totalBytes) parts.push(`${formatSize(item.doneBytes)} / ${formatSize(item.totalBytes)}`);
  if (item.files > 1) parts.push(t('transfers.files', item.filesDone, item.files));
  if (item.status === 'running' && item.bytesPerSecond > 0) {
    parts.push(`${formatSize(item.bytesPerSecond)}/s`);
    const remaining = (item.totalBytes - item.doneBytes) / item.bytesPerSecond;
    if (item.totalBytes && Number.isFinite(remaining)) parts.push(t('transfers.remaining', formatDuration(remaining)));
  }
  if (item.status === 'running' && item.files > 1 && item.currentFile) parts.push(item.currentFile);
  return parts.join(' · ');
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}
