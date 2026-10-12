import type { ReactNode } from 'react';

interface Props {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** Label + control + hint/error, VS Code settings style. */
export function Field({ label, hint, error, children }: Props) {
  return (
    <label className={'he-field' + (error ? ' invalid' : '')}>
      <span className="he-label">{label}</span>
      {children}
      {error ? <span className="he-error">{error}</span> : hint && <span className="he-hint">{hint}</span>}
    </label>
  );
}

interface SecretProps {
  value: string;
  saved: boolean;
  savedPlaceholder: string;
  emptyPlaceholder: string;
  onChange(v: string): void;
  forget?: { label: string; checked: boolean; onChange(v: boolean): void };
}

/** Write-only secret input: shows whether something is saved, never the value. */
export function SecretInput({ value, saved, savedPlaceholder, emptyPlaceholder, onChange, forget }: SecretProps) {
  return (
    <>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        disabled={forget?.checked}
        placeholder={saved ? savedPlaceholder : emptyPlaceholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {saved && forget && (
        <span className="he-check">
          <input type="checkbox" checked={forget.checked} onChange={(e) => forget.onChange(e.target.checked)} />
          {forget.label}
        </span>
      )}
    </>
  );
}
