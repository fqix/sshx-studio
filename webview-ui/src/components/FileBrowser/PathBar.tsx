import { useEffect, useState } from 'react';

interface Props {
  path: string;
  onNavigate(path: string): void;
}

/** Editable path: Enter navigates, Escape reverts. */
export function PathBar({ path, onNavigate }: Props) {
  const [value, setValue] = useState(path);
  useEffect(() => setValue(path), [path]);

  return (
    <input
      className="fb-path"
      spellCheck={false}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate(value.trim() || '/');
        if (e.key === 'Escape') setValue(path);
      }}
    />
  );
}
