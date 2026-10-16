import { t } from '../../i18n';
import './TerminalTabs.css';

interface Props {
  ids: number[];
  active: number;
  onSelect(id: number): void;
  onClose(id: number): void;
  onNew(): void;
  onSearch(): void;
}

/** Terminals of this session tab; each is its own shell on the shared connection. */
export function TerminalTabs({ ids, active, onSelect, onClose, onNew, onSearch }: Props) {
  return (
    <div className="terminal-tabs" role="tablist">
      {ids.map((id) => (
        <div key={id} role="tab" aria-selected={id === active} className={'terminal-tab' + (id === active ? ' active' : '')} onClick={() => onSelect(id)}>
          <i className="codicon codicon-terminal" aria-hidden="true" />
          <span>{t('session.terminal', id)}</span>
          {ids.length > 1 && (
            <button
              className="close"
              title={t('session.closeTerminal')}
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
            >
              <i className="codicon codicon-close" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      <button className="new" title={t('session.newTerminal')} onClick={onNew}>
        <i className="codicon codicon-add" aria-hidden="true" />
      </button>
      <span className="spacer" />
      <button className="search" title={t('search.open', navigator.platform.toUpperCase().includes('MAC') ? '⌘F' : 'Ctrl+F')} onClick={onSearch}>
        <i className="codicon codicon-search" aria-hidden="true" />
      </button>
    </div>
  );
}
