import { useCallback, useMemo, useState } from 'react';
import type { FileEntry } from '@shared/protocol';
import { joinPath, parentPath } from '../utils/path';
import { vscode } from '../vscode/api';
import { useHostMessage } from './useHostMessage';

export interface ClickModifiers {
  shift: boolean;
  toggle: boolean;
}

/** Remote directory state + selection, fed by `fs.*` host messages. */
export function useFileBrowser() {
  const [cwd, setCwd] = useState('');
  const [home, setHome] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useHostMessage((m) => {
    switch (m.type) {
      case 'fs.loading':
        setLoading(true);
        setError(undefined);
        break;
      case 'fs.home':
        setHome(m.home);
        break;
      case 'fs.listing':
        if (m.path !== cwd) {
          setSelected(new Set());
          setAnchor(-1);
        }
        setCwd(m.path);
        setEntries(m.entries);
        setLoading(false);
        setError(undefined);
        break;
      case 'fs.error':
        setLoading(false);
        setError(m.message);
        break;
    }
  });

  const navigate = useCallback((path: string) => vscode.postMessage({ type: 'fs.list', path }), []);

  const selectedEntries = useMemo(() => entries.filter((e) => selected.has(e.name)), [entries, selected]);
  const selectedPaths = useMemo(() => selectedEntries.map((e) => joinPath(cwd, e.name)), [selectedEntries, cwd]);

  const clickRow = useCallback(
    (index: number, mod: ClickModifiers) => {
      const name = entries[index].name;
      if (mod.shift && anchor >= 0) {
        const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)];
        setSelected(new Set(entries.slice(a, b + 1).map((e) => e.name)));
        return;
      }
      setAnchor(index);
      setSelected((prev) => {
        if (!mod.toggle) return new Set([name]);
        const next = new Set(prev);
        next.has(name) ? next.delete(name) : next.add(name);
        return next;
      });
    },
    [entries, anchor],
  );

  /** Right-click: keep a multi-selection if the row is part of it, otherwise select just that row. */
  const ensureSelected = useCallback(
    (index: number) => {
      const name = entries[index].name;
      if (!selected.has(name)) {
        setSelected(new Set([name]));
        setAnchor(index);
      }
    },
    [entries, selected],
  );

  const selectAll = useCallback(() => setSelected(new Set(entries.map((e) => e.name))), [entries]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /** Double-click / Enter: enter directories, open files in the editor. */
  const activate = useCallback(
    (entry: FileEntry) => {
      const p = joinPath(cwd, entry.name);
      if (entry.type === 'dir') navigate(p);
      else vscode.postMessage({ type: 'fs.open', path: p });
    },
    [cwd, navigate],
  );

  return {
    cwd,
    home,
    entries,
    selected,
    selectedEntries,
    selectedPaths,
    loading,
    error,
    navigate,
    goUp: () => navigate(parentPath(cwd)),
    goHome: () => navigate(home),
    refresh: () => navigate(cwd),
    clickRow,
    ensureSelected,
    selectAll,
    clearSelection,
    activate,
  };
}

export type FileBrowserState = ReturnType<typeof useFileBrowser>;
