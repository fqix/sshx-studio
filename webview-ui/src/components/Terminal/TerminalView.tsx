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
  /** Terminal id, chosen by the page; the host keys the shell channel by it. */
  id: number;
  fontSize: number;
  /** Shown and focused; inactive terminals stay alive but hidden. */
  active: boolean;
}

/**
 * `ready` is sent once per page load, by the first terminal; the host connects when it receives it.
 * Later terminals send `term.open` for a new shell on the same connection.
 */
let readySent = false;
export const wasReadySent = () => readySent;
const announced = new Set<number>();

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

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView({ id, fontSize, active }, ref) {
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
      term.onData((data) => vscode.postMessage({ type: 'term.input', term: id, data })),
      term.onResize(({ cols, rows }) => vscode.postMessage({ type: 'term.resize', term: id, cols, rows })),
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
    let sent = false;
    const sendReady = () => {
      if (sent) return;
      sent = true;
      safeFit();
      const size = { term: id, cols: term.cols, rows: term.rows };
      // Re-created xterm (e.g. new font size) for a terminal the host already knows: only its size changed.
      if (announced.has(id)) return vscode.postMessage({ type: 'term.resize', ...size });
      announced.add(id);
      if (readySent) return vscode.postMessage({ type: 'term.open', ...size });
      readySent = true;
      vscode.postMessage({ type: 'ready', ...size });
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
  }, [id, fontSize]);

  // Becoming visible: the container has a size again.
  useEffect(() => {
    if (!active) return;
    try {
      fitRef.current?.fit();
    } catch {
      /* not laid out yet; the ResizeObserver fits later */
    }
    termRef.current?.focus();
  }, [active]);

  useHostMessage((m) => {
    const term = termRef.current;
    if (!term) return;
    if (m.type === 'term.data') {
      if (m.term === id) term.write(m.data);
    } else if (m.type === 'status' && m.state === 'connected') {
      if (!active) return;
      fitRef.current?.fit();
      term.focus();
    } else if (m.type === 'status' && m.state === 'error') {
      term.write(`\r\n\x1b[31m${m.text}\x1b[0m\r\n`);
    }
  });

  return <div className={'terminal-view' + (active ? '' : ' hidden')} ref={containerRef} />;
});
