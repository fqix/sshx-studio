import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileBrowser } from '../../hooks/useFileBrowser';
import { useHostMessage } from '../../hooks/useHostMessage';
import { getPaneDrag, isPaneDrag, setPaneDrag } from '../../utils/paneDrag';
import { joinPath } from '../../utils/path';
import { wasReadySent } from '../Terminal/TerminalView';
import { vscode } from '../../vscode/api';
import { ContextMenu, MenuItem } from './ContextMenu';
import { FileList } from './FileList';
import { PathBar } from './PathBar';
import { Toolbar } from './Toolbar';
import { TransferPanel } from './TransferPanel';
import './FileBrowser.css';
import { t } from '../../i18n';

interface Props {
  style?: React.CSSProperties;
  onCdTerminal(path: string): void;
  /** The local pane's folder while it is shown: downloads can go straight there. */
  localDir?: string;
  localOpen: boolean;
  onToggleLocal(): void;
  onCwd(dir: string): void;
}

export function FileBrowser({ style, onCdTerminal, localDir, localOpen, onToggleLocal, onCwd }: Props) {
  const fb = useFileBrowser();
  const { cwd, selectedPaths, selectedEntries } = fb;
  useEffect(() => {
    if (cwd) onCwd(cwd);
  }, [cwd, onCwd]);
  const [menu, setMenu] = useState<{ x: number; y: number; onRow: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLElement>(null);

  // ------------------------------------------------------------- actions
  const post = vscode.postMessage;
  const actions = {
    mkdir: () => post({ type: 'fs.mkdir', dir: cwd }),
    upload: () => post({ type: 'fs.upload', dir: cwd, folder: false }),
    uploadFolder: () => post({ type: 'fs.upload', dir: cwd, folder: true }),
    download: () => selectedPaths.length && post({ type: 'fs.download', paths: selectedPaths }),
    downloadToLocal: () => selectedPaths.length && localDir && post({ type: 'xfer.download', paths: selectedPaths, dir: localDir }),
    remove: () => selectedPaths.length && post({ type: 'fs.delete', paths: selectedPaths }),
    rename: () => selectedPaths.length === 1 && post({ type: 'fs.rename', path: selectedPaths[0] }),
    open: () => selectedPaths.length === 1 && post({ type: 'fs.open', path: selectedPaths[0] }),
    copyPath: () => navigator.clipboard.writeText(selectedPaths.length ? selectedPaths.join(' ') : cwd),
  };

  // -------------------------------------------------------- context menu
  const single = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
  const menuItems: MenuItem[] = menu?.onRow
    ? [
        ...(single && single.type !== 'dir' ? [{ label: t('menu.open'), run: actions.open }] : []),
        ...(localOpen && localDir ? [{ label: t('files.downloadToLocal', localDir), run: actions.downloadToLocal }] : []),
        { label: t('menu.download'), run: actions.download },
        ...(single?.type === 'dir' ? [{ label: t('menu.cd'), run: () => onCdTerminal(joinPath(cwd, single.name)) }] : []),
        ...(single ? [{ label: t('menu.rename'), run: actions.rename }] : []),
        { label: t('menu.copyPath'), run: actions.copyPath },
        { label: t('menu.delete'), danger: true, run: actions.remove },
      ]
    : [
        { label: t('menu.uploadFiles'), run: actions.upload },
        { label: t('menu.uploadFolder'), run: actions.uploadFolder },
        { label: t('menu.newFolder'), run: actions.mkdir },
        { label: t('menu.cd'), run: () => onCdTerminal(cwd) },
        { label: t('menu.refresh'), run: fb.refresh },
      ];

  const openMenu = (e: React.MouseEvent, index: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (index !== null) fb.ensureSelected(index);
    setMenu({ x: e.clientX, y: e.clientY, onRow: index !== null });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  // ------------------------------------------------------------ keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || (mod && e.key === 'Backspace')) actions.remove();
    else if (e.key === 'F2') actions.rename();
    else if (e.key === 'Enter' && single) fb.activate(single);
    else if (mod && e.key === 'a') {
      e.preventDefault();
      fb.selectAll();
    }
  };

  // ------------------------------------------------- drag & drop upload
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragLeave: () => {
      if (--dragDepth.current <= 0) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const dir = cwd;
      // Rows from the local pane: upload those paths (folders included). Rows from this pane: ignore.
      if (isPaneDrag(e)) {
        const drag = getPaneDrag(e);
        if (drag?.from === 'local') post({ type: 'xfer.upload', paths: drag.paths, dir });
        return;
      }
      for (const f of Array.from(e.dataTransfer.files)) {
        post({ type: 'fs.drop', dir, name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
      }
    },
  };

  // --------------------------------------------------------- diagnostics
  useHostMessage((m) => {
    if (m.type !== 'debug.dump') return;
    const r = rootRef.current?.getBoundingClientRect();
    post({
      type: 'log',
      message:
        `dump: viewport=${innerWidth}x${innerHeight} filesPane=${r && `${r.x},${r.y} ${r.width}x${r.height}`} ` +
        `cwd=${cwd} rows=${fb.entries.length} loading=${fb.loading} error=${fb.error ?? '-'} ready=${wasReadySent()} status=${document.querySelector('.status-bar')?.textContent} visible=${document.visibilityState}`,
    });
  });

  return (
    <aside className={'file-browser' + (dragging ? ' dragging' : '')} style={style} ref={rootRef} {...dropHandlers}>
      <Toolbar
        canDownload={selectedPaths.length > 0}
        onUp={fb.goUp}
        onHome={fb.goHome}
        onRefresh={fb.refresh}
        onCdHere={() => onCdTerminal(cwd)}
        onMkdir={actions.mkdir}
        onUpload={actions.upload}
        onUploadFolder={actions.uploadFolder}
        onDownload={actions.download}
        localOpen={localOpen}
        onToggleLocal={onToggleLocal}
        onDownloadToLocal={localOpen && localDir ? actions.downloadToLocal : undefined}
      />
      <PathBar path={cwd} onNavigate={fb.navigate} />
      <FileList
        entries={fb.entries}
        selected={fb.selected}
        loading={fb.loading}
        onClickRow={fb.clickRow}
        onActivate={fb.activate}
        onClickEmpty={fb.clearSelection}
        onContextMenu={openMenu}
        onKeyDown={onKeyDown}
        onDragStart={(e, i) => {
          fb.ensureSelected(i);
          const name = fb.entries[i].name;
          setPaneDrag(e, { from: 'remote', paths: fb.selected.has(name) ? selectedPaths : [joinPath(cwd, name)] });
        }}
      />
      {fb.error && <div className="fb-error">{fb.error}</div>}
      <TransferPanel />
      <div className="fb-drop-hint">{t('files.dropHint')}</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </aside>
  );
}
