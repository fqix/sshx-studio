import { Tooltip } from './Tooltip';
import './IconButton.css';

interface Props {
  /** Codicon name, e.g. "refresh" (https://microsoft.github.io/vscode-codicons/dist/codicon.html). */
  icon: string;
  label: string;
  onClick(): void;
  disabled?: boolean;
}

/** Toolbar button: codicon + tooltip + accessible label, styled like VS Code's action bar. */
export function IconButton({ icon, label, onClick, disabled }: Props) {
  return (
    <Tooltip text={label}>
      <button type="button" className="icon-button" onClick={onClick} disabled={disabled}>
        <i className={`codicon codicon-${icon}`} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
