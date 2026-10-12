import '@vscode/codicons/dist/codicon.css';
import '@xterm/xterm/css/xterm.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { WebviewConfig } from '@shared/protocol';
import { App } from './App';
import { setLocale } from './i18n';
import { vscode } from './vscode/api';

// Surface webview errors in the extension's Output channel.
window.addEventListener('error', (e) => vscode.postMessage({ type: 'log', message: `error: ${e.message} @${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => vscode.postMessage({ type: 'log', message: `rejection: ${e.reason}` }));

const root = document.getElementById('root')!;
const config: WebviewConfig = JSON.parse(root.dataset.config ?? '{}');
if (import.meta.env.DEV) {
  // Browser dev: ?view=hostEditor&lang=zh-cn
  const q = new URLSearchParams(location.search);
  config.view = (q.get('view') as WebviewConfig['view']) ?? config.view;
  config.locale = q.get('lang') ?? config.locale;
}
setLocale(config.locale ?? navigator.language);

createRoot(root).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
);
