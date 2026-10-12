import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { WebviewConfig } from '../../shared/protocol';

/** Directory (relative to the extension root) holding the Vite build of `webview-ui/`. */
export const WEBVIEW_DIST = ['dist', 'webview'];

/** Page shell for the React app: CSP with a per-load nonce, assets, and injected config. */
export function renderWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, config: WebviewConfig): string {
  const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST, 'assets', file));
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('style.css')}">
</head>
<body>
  <div id="root" data-config='${escapeAttr(JSON.stringify(config))}'></div>
  <script type="module" nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
