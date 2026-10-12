import { useState } from 'react';
import type { KeyType } from '@shared/protocol';
import type { HostEditorModel } from '../../hooks/useHostEditor';
import { t } from '../../i18n';
import { Field, SecretInput } from './Field';

/** keyStored: paste an existing private key or generate a new pair; shows the public key. */
export function StoredKeySection({ m }: { m: HostEditorModel }) {
  const { draft, state, error } = m;
  const [mode, setMode] = useState<'paste' | 'generate'>('paste');
  const [keyType, setKeyType] = useState<KeyType>('ed25519');
  const [newPassphrase, setNewPassphrase] = useState('');
  if (!draft || !state) return null;

  return (
    <>
      {state.saved.privateKey && !m.generated && !draft.privateKey && <p className="he-note">{t('key.stored')}</p>}

      <div className="he-tabs" role="tablist">
        {(['paste', 'generate'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
            {t(k === 'paste' ? 'key.paste' : 'key.generate')}
          </button>
        ))}
      </div>

      {mode === 'paste' ? (
        <>
          <Field label={t('key.paste')} error={error?.field === 'privateKey' ? error.message : undefined}>
            <textarea
              rows={6}
              spellCheck={false}
              value={draft.privateKey}
              placeholder={t('key.pastePlaceholder')}
              onChange={(e) => m.update('privateKey', e.target.value)}
            />
          </Field>
          <Field label={t('editor.passphrase')} error={error?.field === 'passphrase' ? error.message : undefined}>
            <SecretInput
              value={draft.passphrase}
              saved={state.saved.passphrase}
              savedPlaceholder={t('editor.passphraseSaved')}
              emptyPlaceholder={t('editor.passphraseOptional')}
              onChange={(v) => m.update('passphrase', v)}
              forget={{ label: t('editor.forgetPassphrase'), checked: draft.clearPassphrase, onChange: (v) => m.update('clearPassphrase', v) }}
            />
          </Field>
        </>
      ) : (
        <div className="he-row">
          <Field label={t('key.type')}>
            <select value={keyType} onChange={(e) => setKeyType(e.target.value as KeyType)}>
              <option value="ed25519">Ed25519</option>
              <option value="rsa">RSA 4096</option>
            </select>
          </Field>
          <Field label={t('key.newPassphrase')}>
            <input type="password" autoComplete="new-password" value={newPassphrase} onChange={(e) => setNewPassphrase(e.target.value)} />
          </Field>
          <button type="button" className="secondary he-inline-button" onClick={() => m.generateKey(keyType, newPassphrase)}>
            {t('key.generateButton')}
          </button>
        </div>
      )}

      {m.generated && <p className="he-note success">{t('key.generated')}</p>}

      {m.publicKey && (
        <Field label={t('key.publicKey')} hint={t('key.publicKeyHint')}>
          <div className="he-pubkey">
            <code>{m.publicKey}</code>
            <button type="button" className="secondary" onClick={() => m.copy(m.publicKey)}>
              {t('key.copy')}
            </button>
          </div>
        </Field>
      )}
    </>
  );
}
