import { AuthSection } from '../components/HostEditor/AuthSection';
import { Field } from '../components/HostEditor/Field';
import { useHostEditor } from '../hooks/useHostEditor';
import { t } from '../i18n';
import '../components/HostEditor/HostEditor.css';

/** Create / edit a host. Secrets are write-only: the form only learns whether they exist. */
export function HostEditorPage() {
  const m = useHostEditor();
  const { draft, state, error } = m;
  if (!draft || !state) return <div className="he-page he-loading">{t('editor.loading')}</div>;
  const fieldError = (f: string) => (error?.field === f ? error.message : undefined);

  return (
    <form
      className="he-page"
      onSubmit={(e) => {
        e.preventDefault();
        m.save();
      }}
    >
      <h1>{draft.id ? `${t('editor.titleEdit')} · ${draft.alias}` : t('editor.titleNew')}</h1>

      <section className="he-section">
        <h2>{t('editor.connection')}</h2>
        <Field label={t('editor.alias')} hint={t('editor.aliasHint')} error={fieldError('alias')}>
          <input autoFocus value={draft.alias} spellCheck={false} placeholder="prod-web" onChange={(e) => m.update('alias', e.target.value)} />
        </Field>
        <div className="he-row">
          <Field label={t('editor.hostname')} error={fieldError('hostname')}>
            <input value={draft.hostname} spellCheck={false} placeholder="10.0.0.5 / example.com" onChange={(e) => m.update('hostname', e.target.value)} />
          </Field>
          <Field label={t('editor.port')} error={fieldError('port')}>
            <input className="he-port" type="number" min={1} max={65535} value={draft.port} onChange={(e) => m.update('port', Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('editor.username')}>
          <input value={draft.username} spellCheck={false} placeholder={t('editor.usernamePlaceholder')} onChange={(e) => m.update('username', e.target.value)} />
        </Field>
        {state.groups.length > 0 && (
          <Field label={t('editor.group')} error={fieldError('groupId')}>
            <select value={draft.groupId ?? ''} onChange={(e) => m.update('groupId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('editor.noGroup')}</option>
              {state.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.path}
                </option>
              ))}
            </select>
          </Field>
        )}
      </section>

      <AuthSection m={m} />

      <section className="he-section">
        <h2>{t('editor.forwarding')}</h2>
        <label className="he-toggle">
          <input type="checkbox" checked={draft.forwardAgent} onChange={(e) => m.update('forwardAgent', e.target.checked)} />
          <span>
            <strong>{t('editor.forwardAgent')}</strong>
            <span className="he-hint">{t('editor.forwardAgentHint')}</span>
          </span>
        </label>
        <label className="he-toggle">
          <input type="checkbox" checked={draft.forwardX11} onChange={(e) => m.update('forwardX11', e.target.checked)} />
          <span>
            <strong>{t('editor.forwardX11')}</strong>
            <span className="he-hint">{t('editor.forwardX11Hint')}</span>
          </span>
        </label>
        <p className="he-hint">{t('editor.portForwardHint')}</p>
      </section>

      <details className="he-section" open={!!(draft.proxyJump || draft.proxyCommand)}>
        <summary>
          <h2>{t('editor.advanced')}</h2>
        </summary>
        <Field label={t('editor.proxyJump')} hint={t('editor.proxyJumpHint')} error={fieldError('proxyJump')}>
          <input list="he-aliases" value={draft.proxyJump} spellCheck={false} placeholder="bastion" onChange={(e) => m.update('proxyJump', e.target.value)} />
          <datalist id="he-aliases">
            {state.otherAliases.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label={t('editor.proxyCommand')} hint={t('editor.proxyCommandHint')}>
          <input value={draft.proxyCommand} spellCheck={false} placeholder="nc -X 5 -x proxy:1080 %h %p" onChange={(e) => m.update('proxyCommand', e.target.value)} />
        </Field>
      </details>

      {error && !error.field && <div className="he-banner">{error.message}</div>}
      {m.testResult && (
        <div className={`he-test-result ${m.testResult.ok ? 'ok' : 'failed'}`} role="status">
          <i className={`codicon codicon-${m.testResult.ok ? 'pass-filled' : 'error'}`} aria-hidden="true" />
          <div>
            <strong>{m.testResult.message}</strong>
            {m.testResult.details.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
        </div>
      )}

      <footer className="he-footer">
        <button type="submit" disabled={m.saving || m.testing}>
          {t('editor.save')}
        </button>
        <button type="button" className="secondary" onClick={m.test} disabled={m.testing || m.saving}>
          <i className={`codicon ${m.testing ? 'codicon-loading codicon-modifier-spin' : 'codicon-debug-disconnect'}`} aria-hidden="true" />
          {m.testing ? t('editor.testing') : t('editor.test')}
        </button>
        <button type="button" className="secondary" onClick={m.cancel}>
          {t('editor.cancel')}
        </button>
      </footer>
    </form>
  );
}
