import type { WebviewMessage } from '@shared/protocol';
import { createMockHost } from './mockHost';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

/**
 * The real VS Code API inside a webview; in a plain browser (`npm run dev`) a mock backend
 * that fakes a host so the UI can be developed without the extension.
 */
export const vscode: VsCodeApi =
  import.meta.env.DEV && typeof acquireVsCodeApi !== 'function' ? createMockHost() : acquireVsCodeApi();

/** Typed persisted UI state (survives the panel being hidden / VS Code reload). */
export interface UiState {
  filesWidth?: number;
  /** Local pane shown, and its width. */
  localOpen?: boolean;
  localWidth?: number;
}

export function getUiState(): UiState {
  return vscode.getState<UiState>() ?? {};
}

export function patchUiState(patch: Partial<UiState>) {
  vscode.setState({ ...getUiState(), ...patch });
}
