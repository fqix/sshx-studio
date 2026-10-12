import type { ConnectionState } from '@shared/protocol';
import './StatusBar.css';
import { t } from '../../i18n';

interface Props {
  state: ConnectionState;
  text: string;
  onReconnect(): void;
}

export function StatusBar({ state, text, onReconnect }: Props) {
  const canReconnect = state === 'disconnected' || state === 'error';
  return (
    <div className={`status-bar ${state}`}>
      <span className="dot" />
      <span className="text" title={text}>
        {text}
      </span>
      {canReconnect && (
        <button className="reconnect" onClick={onReconnect}>
          {t('session.reconnect')}
        </button>
      )}
    </div>
  );
}
