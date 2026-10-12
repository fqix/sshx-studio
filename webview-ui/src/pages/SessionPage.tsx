import { useCallback, useRef, useState } from 'react';
import type { ConnectionState, WebviewConfig } from '@shared/protocol';
import { FileBrowser } from '../components/FileBrowser/FileBrowser';
import { StatusBar } from '../components/StatusBar/StatusBar';
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
  const terminal = useRef<TerminalHandle>(null);
  const { width, startDrag } = useResizableWidth({
    initial: getUiState().filesWidth ?? 320,
    min: 220,
    reserve: 200,
    onCommit: useCallback((w: number) => patchUiState({ filesWidth: w }), []),
  });

  useHostMessage((m) => {
    if (m.type === 'status') setStatus({ state: m.state, text: m.text });
  });

  const cdInTerminal = useCallback((path: string) => {
    vscode.postMessage({ type: 'fs.cdTerminal', path });
    terminal.current?.focus();
  }, []);

  return (
    <div className="session-page">
      <section className="terminal-pane">
        <StatusBar {...status} onReconnect={() => vscode.postMessage({ type: 'reconnect' })} />
        <TerminalView ref={terminal} fontSize={config.terminalFontSize || 13} />
      </section>
      <div className="splitter" onMouseDown={startDrag} />
      <FileBrowser style={{ width }} onCdTerminal={cdInTerminal} />
    </div>
  );
}
