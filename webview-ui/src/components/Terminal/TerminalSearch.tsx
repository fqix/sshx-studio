import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import './TerminalSearch.css';

interface Props {
  search: SearchAddon;
  onClose(): void;
}

/** #RRGGBB from a VS Code color variable (xterm decorations accept nothing else), or the fallback. */
function hexVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}/i.test(v) ? v.slice(0, 7) : fallback;
}

function decorations(): ISearchOptions['decorations'] {
  const match = hexVar('--vscode-terminal-findMatchHighlightBackground', hexVar('--vscode-editor-findMatchHighlightBackground', '#ea5c00'));
  const active = hexVar('--vscode-terminal-findMatchBackground', hexVar('--vscode-editor-findMatchBackground', '#515c6a'));
  return { matchBackground: match, matchOverviewRuler: match, activeMatchBackground: active, activeMatchColorOverviewRuler: active };
}

/** Find widget over the terminal, like VS Code's: Enter / Shift+Enter for next / previous, Esc closes. */
export function TerminalSearch({ search, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<{ index: number; count: number }>();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) => setResults({ index: resultIndex, count: resultCount }));
    return () => {
      sub.dispose();
      search.clearDecorations();
    };
  }, [search]);

  const run = (direction: 'next' | 'previous', incremental = false) => {
    if (regex) {
      try {
        new RegExp(term);
      } catch {
        setInvalid(true);
        return;
      }
    }
    setInvalid(false);
    if (!term) {
      search.clearDecorations();
      setResults(undefined);
      return;
    }
    const options: ISearchOptions = { caseSensitive, regex, wholeWord, incremental, decorations: decorations() };
    if (direction === 'next') search.findNext(term, options);
    else search.findPrevious(term, options);
  };

  // Search as you type, and again when an option changes.
  useEffect(() => run('next', true), [term, caseSensitive, regex, wholeWord]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (on: boolean, set: (v: boolean) => void, icon: string, title: string) => (
    <button type="button" className={'toggle' + (on ? ' on' : '')} title={title} aria-pressed={on} onClick={() => set(!on)}>
      <i className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );

  const count = !term ? '' : !results || results.count === 0 ? t('search.noResults') : results.index < 0 ? `?/${results.count}` : `${results.index + 1}/${results.count}`;

  return (
    <div className="terminal-search" role="search" onMouseDown={(e) => e.stopPropagation()}>
      <div className={'field' + (invalid ? ' invalid' : '')}>
        <input
          ref={input}
          value={term}
          spellCheck={false}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run(e.shiftKey ? 'previous' : 'next');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        {toggle(caseSensitive, setCaseSensitive, 'case-sensitive', t('search.caseSensitive'))}
        {toggle(wholeWord, setWholeWord, 'whole-word', t('search.wholeWord'))}
        {toggle(regex, setRegex, 'regex', t('search.regex'))}
      </div>
      <span className="count">{count}</span>
      <button type="button" title={t('search.previous')} onClick={() => run('previous')} disabled={!term}>
        <i className="codicon codicon-arrow-up" aria-hidden="true" />
      </button>
      <button type="button" title={t('search.next')} onClick={() => run('next')} disabled={!term}>
        <i className="codicon codicon-arrow-down" aria-hidden="true" />
      </button>
      <button type="button" title={t('search.close')} onClick={onClose}>
        <i className="codicon codicon-close" aria-hidden="true" />
      </button>
    </div>
  );
}
