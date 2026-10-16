import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileBrowser } from '../../hooks/useFileBrowser';
import { t } from '../../i18n';
import { getPaneDrag, isPaneDrag, setPaneDrag } from '../../utils/paneDrag';
import { vscode } from '../../vscode/api';
import { IconButton } from '../common/IconButton';
import { ContextMenu, MenuItem } from './ContextMenu';
import { FileList } from './FileList';
import { PathBar } from './PathBar';
import './FileBrowser.css';

interface Props {
  style?: React.CSSProperties;
  /** Remote folder shown in the other pane: where uploads from here go. */
  remoteDir: string;
  onCwd(dir: string): void;
  onClose(): void;
}

/** Files on this machine, next to the remote pane; drag or send files across to transfer them. */
export function LocalBrowser({ style, remoteDir, onCwd, onClose }: Props) {
  const fb = useFileBrowser('local');
  const { cwd, selectedPaths, selectedEntries } = fb;
  const [menu, setMenu] = useState<{ x: number; y: number; onRow: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const post = vscode.postMessage;

  useEffect(() => post({ type: 'local.list', path: '' }), [post]);
  useEffect(() => {
    if (cwd) onCwd(cwd);
  }, [cwd, onCwd]);

  const actions = {
    upload: () => selectedPaths.length && remoteDir && post({ type: 'xfer.upload', paths: selectedPaths, dir: remoteDir }),
    mkdir: () => post({ type: 'local.mkdir', dir: cwd }),
    rename: () => selectedPaths.length === 1 && post({ type: 'local.rename', path: selectedPaths[0] }),
    remove: () => selectedPaths.length && post({ type: 'local.delete', paths: selectedPaths }),
    reveal: () => post({ type: 'local.reveal', path: selectedPaths[0] ?? cwd }),
    copyPath: () => navigator.clipboard.writeText(selectedPaths.length ? selectedPaths.join(' ') : cwd),
  };

  const single = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
  const menuItems: MenuItem[] = menu?.onRow
    ? [
        ...(single ? [{ label: single.type === 'dir' ? t('local.openFolder') : t('menu.open'), run: () => fb.activate(single) }] : []),
        { label: t('local.uploadTo', remoteDir), run: actions.upload },
        { label: t('local.reveal'), run: actions.reveal },
        ...(single ? [{ label: t('menu.rename'), run: actions.rename }] : []),
        { label: t('menu.copyPath'), run: actions.copyPath },
        { label: t('local.trash'), danger: true, run: actions.remove },
      ]
    : [
        { label: t('menu.newFolder'), run: actions.mkdir },
        { label: t('local.reveal'), run: actions.reveal },
        { label: t('menu.refresh'), run: fb.refresh },
      ];

  const openMenu = (e: React.MouseEvent, index: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (index !== null) fb.ensureSelected(index);
    setMenu({ x: e.clientX, y: e.clientY, onRow: index !== null });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

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

  // Rows dragged from the remote pane download into this folder.
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isPaneDrag(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDropping(true);
    },
    onDragLeave: () => {
      if (--dragDepth.current <= 0) setDropping(false);
    },
    onDragOver: (e: React.DragEvent) => isPaneDrag(e) && e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      const drag = getPaneDrag(e);
      if (drag?.from === 'remote' && cwd) post({ type: 'xfer.download', paths: drag.paths, dir: cwd });
    },
  };

  return (
    <aside className={'file-browser local' + (dropping ? ' dragging' : '')} style={style} aria-label={t('local.title')} {...dropHandlers}>
      <div className="fb-toolbar" role="toolbar">
        <span className="fb-pane-title">{t('local.title')}</span>
        <IconButton icon="arrow-up" label={t('files.up')} onClick={fb.goUp} />
        <IconButton icon="home" label={t('files.home')} onClick={fb.goHome} />
        <IconButton icon="refresh" label={t('files.refresh')} onClick={fb.refresh} />
        <span className="spacer" />
        <IconButton icon="new-folder" label={t('files.newFolder')} onClick={actions.mkdir} />
        <IconButton icon="arrow-right" label={t('local.uploadTo', remoteDir)} onClick={actions.upload} disabled={!selectedPaths.length || !remoteDir} />
        <IconButton icon="close" label={t('local.hide')} onClick={onClose} />
      </div>
      <PathBar path={cwd} onNavigate={fb.navigate} />
      <FileList
        entries={fb.entries}
        selected={fb.selected}
        loading={!cwd && !fb.error}
        onClickRow={fb.clickRow}
        onActivate={fb.activate}
        onClickEmpty={fb.clearSelection}
        onContextMenu={openMenu}
        onKeyDown={onKeyDown}
        onDragStart={(e, i) => {
          fb.ensureSelected(i);
          const name = fb.entries[i].name;
          setPaneDrag(e, { from: 'local', paths: fb.selected.has(name) ? selectedPaths : [fb.join(name)] });
        }}
      />
      {fb.error && <div className="fb-error">{fb.error}</div>}
      <div className="fb-drop-hint">{t('local.dropHint')}</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </aside>
  );
}
