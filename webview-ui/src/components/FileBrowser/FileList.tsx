import type { FileEntry } from '@shared/protocol';
import type { ClickModifiers } from '../../hooks/useFileBrowser';
import { formatDate, formatMode, formatSize } from '../../utils/format';
import { t } from '../../i18n';

interface Props {
  entries: FileEntry[];
  selected: ReadonlySet<string>;
  loading: boolean;
  onClickRow(index: number, mod: ClickModifiers): void;
  onActivate(entry: FileEntry): void;
  onClickEmpty(): void;
  onContextMenu(e: React.MouseEvent, index: number | null): void;
  onKeyDown(e: React.KeyboardEvent): void;
}

const ICONS: Record<FileEntry['type'], string> = { dir: 'folder', link: 'file-symlink-file', file: 'file' };

export function FileList(p: Props) {
  return (
    <div
      className="fb-list"
      tabIndex={0}
      onKeyDown={p.onKeyDown}
      onClick={(e) => e.target === e.currentTarget && p.onClickEmpty()}
      onContextMenu={(e) => e.target === e.currentTarget && p.onContextMenu(e, null)}
    >
      {p.loading && p.entries.length === 0 && <div className="fb-placeholder">{t('files.opening')}</div>}
      {!p.loading && p.entries.length === 0 && <div className="fb-placeholder">{t('files.empty')}</div>}
      {p.entries.map((e, i) => (
        <div
          key={e.name}
          className={'fb-row' + (p.selected.has(e.name) ? ' selected' : '')}
          title={`${e.name}\n${formatSize(e.size)} · ${formatDate(e.mtime)} · ${formatMode(e.mode)}`}
          onClick={(ev) => p.onClickRow(i, { shift: ev.shiftKey, toggle: ev.metaKey || ev.ctrlKey })}
          onDoubleClick={() => p.onActivate(e)}
          onContextMenu={(ev) => p.onContextMenu(ev, i)}
        >
          <i className={`icon codicon codicon-${ICONS[e.type]}`} aria-hidden="true" />
          <span className="name">{e.name}</span>
          <span className="size">{e.type === 'dir' ? '' : formatSize(e.size)}</span>
        </div>
      ))}
    </div>
  );
}
