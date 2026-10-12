import { useCallback, useEffect, useState } from 'react';
import type { HostDraft, HostDraftField, HostEditorState, KeyType } from '@shared/protocol';
import { vscode } from '../vscode/api';
import { useHostMessage } from './useHostMessage';

/** Form state for the host editor, synced with the extension. */
export function useHostEditor() {
  const [state, setState] = useState<HostEditorState>();
  const [draft, setDraft] = useState<HostDraft>();
  const [publicKey, setPublicKey] = useState('');
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<{ message: string; field?: HostDraftField }>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; details: string[] }>();

  useEffect(() => vscode.postMessage({ type: 'editor.ready' }), []);

  useHostMessage((m) => {
    switch (m.type) {
      case 'editor.init':
        setState(m.state);
        setDraft(m.state.draft);
        setPublicKey(m.state.publicKey);
        break;
      case 'editor.keyFile':
        setDraft((d) => d && { ...d, identityFile: m.path });
        break;
      case 'editor.generated':
        setPublicKey(m.publicKey);
        setGenerated(true);
        setDraft((d) => d && { ...d, privateKey: '' });
        break;
      case 'editor.error':
        setError({ message: m.message, field: m.field });
        setSaving(false);
        setTesting(false);
        break;
      case 'editor.testResult':
        setTesting(false);
        setTestResult({ ok: m.ok, message: m.message, details: m.details });
        break;
    }
  });

  const update = useCallback(<K extends keyof HostDraft>(key: K, value: HostDraft[K]) => {
    setDraft((d) => d && { ...d, [key]: value });
    setError((e) => (e?.field === key ? undefined : e));
    setTestResult(undefined); // the result described the old values
  }, []);

  return {
    state,
    draft,
    publicKey,
    generated,
    error,
    saving,
    testing,
    testResult,
    update,
    test: () => {
      if (!draft) return;
      setTesting(true);
      setError(undefined);
      setTestResult(undefined);
      vscode.postMessage({ type: 'editor.test', draft });
    },
    save: () => {
      if (!draft) return;
      setSaving(true);
      setError(undefined);
      vscode.postMessage({ type: 'editor.save', draft });
    },
    cancel: () => vscode.postMessage({ type: 'editor.cancel' }),
    browseKeyFile: () => vscode.postMessage({ type: 'editor.browseKeyFile' }),
    generateKey: (keyType: KeyType, passphrase: string) => vscode.postMessage({ type: 'editor.generateKey', keyType, passphrase }),
    copy: (text: string) => vscode.postMessage({ type: 'editor.copy', text }),
  };
}

export type HostEditorModel = ReturnType<typeof useHostEditor>;
