import { useCallback, useRef, useState } from 'react';
import type { ConnectionState, WebviewConfig } from '@shared/protocol';
import { FileBrowser } from '../components/FileBrowser/FileBrowser';
import { LocalBrowser } from '../components/FileBrowser/LocalBrowser';
import { StatusBar } from '../components/StatusBar/StatusBar';
import { TerminalTabs } from '../components/Terminal/TerminalTabs';
import { TerminalHandle, TerminalView } from '../components/Terminal/TerminalView';
import { useHostMessage } from '../hooks/useHostMessage';
import { useResizableWidth } from '../hooks/useResizableWidth';
import { getUiState, patchUiState, vscode } from '../vscode/api';
import { t } from '../i18n';
import './SessionPage.css';

export function SessionPage({ config }: { config: WebviewConfig }) {
  const [status, setStatus] = useState<{ state: ConnectionState; text: string }>({
    state: 'connecting',
    text: t('session.connecting', config.alias),
  });
  // Terminals in this tab, each a shell on the same connection. Ids are never reused.
  const [terms, setTerms] = useState<number[]>([1]);
  const [activeTerm, setActiveTerm] = useState(1);
  const nextId = useRef(2);
  const handles = useRef(new Map<number, TerminalHandle>());
  const { width, startDrag } = useResizableWidth({
    initial: getUiState().filesWidth ?? 320,
    min: 220,
    reserve: 200,
    onCommit: useCallback((w: number) => patchUiState({ filesWidth: w }), []),
  });
  // Local pane: docked left of the remote pane, with its own splitter on its right edge.
  const [localOpen, setLocalOpen] = useState(!!getUiState().localOpen);
  const local = useResizableWidth({
    initial: getUiState().localWidth ?? 300,
    min: 200,
    reserve: width + 200,
    edge: 'right',
    onCommit: useCallback((w: number) => patchUiState({ localWidth: w }), []),
  });
  const [localDir, setLocalDir] = useState('');
  const [remoteDir, setRemoteDir] = useState('');
  const toggleLocal = () => {
    patchUiState({ localOpen: !localOpen });
    setLocalOpen(!localOpen);
  };

  const newTerminal = useCallback(() => {
    const id = nextId.current++;
    setTerms((ts) => [...ts, id]);
    setActiveTerm(id);
  }, []);

  const closeTerminal = (id: number) => {
    if (terms.length < 2) return;
    vscode.postMessage({ type: 'term.close', term: id });
    const rest = terms.filter((x) => x !== id);
    setTerms(rest);
    if (id === activeTerm) setActiveTerm(rest[Math.max(0, terms.indexOf(id) - 1)]);
  };

  useHostMessage((m) => {
    if (m.type === 'status') setStatus({ state: m.state, text: m.text });
    else if (m.type === 'term.new') newTerminal();
  });

  const cdInTerminal = (path: string) => {
    vscode.postMessage({ type: 'fs.cdTerminal', path, term: activeTerm });
    handles.current.get(activeTerm)?.focus();
  };

  return (
    <div className="session-page">
      <section className="terminal-pane">
        <StatusBar {...status} onReconnect={() => vscode.postMessage({ type: 'reconnect' })} />
        <TerminalTabs ids={terms} active={activeTerm} onSelect={setActiveTerm} onClose={closeTerminal} onNew={newTerminal} onSearch={() => handles.current.get(activeTerm)?.openSearch()} />
        {terms.map((id) => (
          <TerminalView
            key={id}
            id={id}
            active={id === activeTerm}
            fontSize={config.terminalFontSize || 13}
            ref={(h) => {
              if (h) handles.current.set(id, h);
              else handles.current.delete(id);
            }}
          />
        ))}
      </section>
      <div className="splitter" onMouseDown={startDrag} />
      {localOpen && (
        <>
          <LocalBrowser style={{ width: local.width }} remoteDir={remoteDir} onCwd={setLocalDir} onClose={toggleLocal} />
          <div className="splitter" onMouseDown={local.startDrag} />
        </>
      )}
      <FileBrowser
        style={{ width }}
        onCdTerminal={cdInTerminal}
        localOpen={localOpen}
        localDir={localDir}
        onToggleLocal={toggleLocal}
        onCwd={setRemoteDir}
      />
    </div>
  );
}
