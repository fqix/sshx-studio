import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useHostMessage } from '../../hooks/useHostMessage';
import { vscode } from '../../vscode/api';
import './TerminalView.css';

export interface TerminalHandle {
  focus(): void;
}

interface Props {
  fontSize: number;
}

/** Sent once per page load; the host opens the SSH session when it receives it. */
let readySent = false;
export const wasReadySent = () => readySent;

function themeFromVsCode() {
  const css = getComputedStyle(document.body);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  return {
    fontFamily: v('--vscode-editor-font-family') || 'Menlo, monospace',
    theme: {
      background: v('--vscode-terminal-background') || v('--vscode-editor-background'),
      foreground: v('--vscode-terminal-foreground') || v('--vscode-editor-foreground'),
      cursor: v('--vscode-terminalCursor-foreground'),
      selectionBackground: v('--vscode-terminal-selectionBackground'),
    },
  };
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView({ fontSize }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>();
  const fitRef = useRef<FitAddon>();

  useImperativeHandle(ref, () => ({ focus: () => termRef.current?.focus() }), []);

  useEffect(() => {
    const { fontFamily, theme } = themeFromVsCode();
    const term = new Terminal({ fontSize, fontFamily, theme, cursorBlink: true, scrollback: 10000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    const subs = [
      term.onData((data) => vscode.postMessage({ type: 'term.input', data })),
      term.onResize(({ cols, rows }) => vscode.postMessage({ type: 'term.resize', cols, rows })),
    ];
    // Cmd/Ctrl+C copies when there is a selection; otherwise it goes to the remote as ^C.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      return true;
    });

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* container hidden */
      }
    };
    const ro = new ResizeObserver(safeFit);
    ro.observe(containerRef.current!);

    // Prefer waiting one frame so the layout has its final size, but don't depend on it:
    // requestAnimationFrame never fires while the webview isn't being rendered (hidden tab,
    // minimized window, VS Code busy with a startup notification). A later fit() sends term.resize.
    const sendReady = () => {
      if (readySent) return;
      readySent = true;
      safeFit();
      vscode.postMessage({ type: 'ready', cols: term.cols, rows: term.rows });
    };
    const raf = requestAnimationFrame(sendReady);
    const fallback = setTimeout(sendReady, 150);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      ro.disconnect();
      subs.forEach((s) => s.dispose());
      term.dispose();
    };
  }, [fontSize]);

  useHostMessage((m) => {
    const term = termRef.current;
    if (!term) return;
    if (m.type === 'term.data') term.write(m.data);
    else if (m.type === 'status' && m.state === 'connected') {
      fitRef.current?.fit();
      term.focus();
    } else if (m.type === 'status' && m.state === 'error') {
      term.write(`\r\n\x1b[31m${m.text}\x1b[0m\r\n`);
    }
  });

  return <div className="terminal-view" ref={containerRef} />;
});
