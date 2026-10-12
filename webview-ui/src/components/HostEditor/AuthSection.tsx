import type { AuthMethod } from '@shared/protocol';
import type { HostEditorModel } from '../../hooks/useHostEditor';
import { MessageKey, t } from '../../i18n';
import { Field, SecretInput } from './Field';
import { StoredKeySection } from './StoredKeySection';

const METHODS: { value: AuthMethod; label: MessageKey; hint: MessageKey }[] = [
  { value: 'auto', label: 'auth.auto', hint: 'auth.autoHint' },
  { value: 'password', label: 'auth.password', hint: 'editor.passwordOptional' },
  { value: 'keyFile', label: 'auth.keyFile', hint: 'auth.keyFileHint' },
  { value: 'keyStored', label: 'auth.keyStored', hint: 'auth.keyStoredHint' },
];

export function AuthSection({ m }: { m: HostEditorModel }) {
  const { draft, state, error } = m;
  if (!draft || !state) return null;
  const method = draft.authMethod;
  const fieldError = (f: string) => (error?.field === f ? error.message : undefined);

  const password = (
    <Field label={t('editor.password')}>
      <SecretInput
        value={draft.password}
        saved={state.saved.password}
        savedPlaceholder={t('editor.passwordSaved')}
        emptyPlaceholder={t('editor.passwordOptional')}
        onChange={(v) => m.update('password', v)}
        forget={{ label: t('editor.forgetPassword'), checked: draft.clearPassword, onChange: (v) => m.update('clearPassword', v) }}
      />
    </Field>
  );

  const keyFile = (optional: boolean) => (
    <>
      <Field label={t('editor.identityFile')} error={fieldError('identityFile')} hint={optional ? t('editor.identityFileOptional') : undefined}>
        <div className="he-input-with-button">
          <input value={draft.identityFile} spellCheck={false} placeholder="~/.ssh/id_ed25519" onChange={(e) => m.update('identityFile', e.target.value)} />
          <button type="button" className="secondary" onClick={m.browseKeyFile}>
            {t('editor.browse')}
          </button>
        </div>
      </Field>
      {!optional && (
        <Field label={t('editor.passphrase')}>
          <SecretInput
            value={draft.passphrase}
            saved={state.saved.passphrase}
            savedPlaceholder={t('editor.passphraseSaved')}
            emptyPlaceholder={t('editor.passphraseOptional')}
            onChange={(v) => m.update('passphrase', v)}
            forget={{ label: t('editor.forgetPassphrase'), checked: draft.clearPassphrase, onChange: (v) => m.update('clearPassphrase', v) }}
          />
        </Field>
      )}
    </>
  );

  return (
    <section className="he-section">
      <h2>{t('editor.auth')}</h2>
      <div className="he-segmented" role="radiogroup">
        {METHODS.map((x) => (
          <button key={x.value} type="button" role="radio" aria-checked={method === x.value} className={method === x.value ? 'active' : ''} onClick={() => m.update('authMethod', x.value)}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <p className="he-hint">{t(METHODS.find((x) => x.value === method)!.hint)}</p>

      {method === 'auto' && (
        <>
          {keyFile(true)}
          {password}
        </>
      )}
      {method === 'password' && password}
      {method === 'keyFile' && keyFile(false)}
      {method === 'keyStored' && <StoredKeySection m={m} />}
    </section>
  );
}
