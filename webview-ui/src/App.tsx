import type { WebviewConfig } from '@shared/protocol';
import { HostEditorPage } from './pages/HostEditorPage';
import { SessionPage } from './pages/SessionPage';

/** One bundle, two pages: the extension picks which via `config.view`. */
export function App({ config }: { config: WebviewConfig }) {
  return config.view === 'hostEditor' ? <HostEditorPage /> : <SessionPage config={config} />;
}
