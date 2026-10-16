import { useCallback, useMemo, useState } from 'react';
import type { FileEntry } from '@shared/protocol';
import { joinPath, parentPath } from '../utils/path';
import { vscode } from '../vscode/api';
import { useHostMessage } from './useHostMessage';

export interface ClickModifiers {
  shift: boolean;
  toggle: boolean;
}

/**
 * Directory state + selection for one pane: the remote side (`fs.*` messages, POSIX paths) or
 * this machine (`local.*` messages, paths in the host OS's format).
 */
export function useFileBrowser(kind: 'remote' | 'local' = 'remote') {
  const [cwd, setCwd] = useState('');
  const [home, setHome] = useState(kind === 'remote' ? '/' : '');
  // Local only: separator and parent come from the extension (Windows paths aren't POSIX).
  const [sep, setSep] = useState('/');
  const [parent, setParent] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const showListing = (path: string, list: FileEntry[]) => {
    if (path !== cwd) {
      setSelected(new Set());
      setAnchor(-1);
    }
    setCwd(path);
    setEntries(list);
    setLoading(false);
    setError(undefined);
  };

  useHostMessage((m) => {
    if (kind === 'local') {
      if (m.type === 'local.listing') {
        setSep(m.sep);
        setParent(m.parent);
        setHome(m.home);
        showListing(m.path, m.entries);
      } else if (m.type === 'local.error') {
        setLoading(false);
        setError(m.message);
      }
      return;
    }
    switch (m.type) {
      case 'fs.loading':
        setLoading(true);
        setError(undefined);
        break;
      case 'fs.home':
        setHome(m.home);
        break;
      case 'fs.listing':
        showListing(m.path, m.entries);
        break;
      case 'fs.error':
        setLoading(false);
        setError(m.message);
        break;
    }
  });

  const navigate = useCallback((path: string) => vscode.postMessage({ type: kind === 'remote' ? 'fs.list' : 'local.list', path }), [kind]);
  const join = useCallback(
    (name: string) => (kind === 'remote' ? joinPath(cwd, name) : (cwd.endsWith(sep) ? cwd : cwd + sep) + name),
    [kind, cwd, sep],
  );

  const selectedEntries = useMemo(() => entries.filter((e) => selected.has(e.name)), [entries, selected]);
  const selectedPaths = useMemo(() => selectedEntries.map((e) => join(e.name)), [selectedEntries, join]);

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
      const p = join(entry.name);
      if (entry.type === 'dir') navigate(p);
      else vscode.postMessage({ type: kind === 'remote' ? 'fs.open' : 'local.open', path: p });
    },
    [join, navigate, kind],
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
    join,
    goUp: () => navigate(kind === 'remote' ? parentPath(cwd) : parent || cwd),
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
