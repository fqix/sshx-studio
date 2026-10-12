import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  run(): void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current!;
    setPos({
      left: Math.min(x, window.innerWidth - el.offsetWidth - 4),
      top: Math.min(y, window.innerHeight - el.offsetHeight - 4),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="context-menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <div
          key={it.label}
          className={it.danger ? 'danger' : undefined}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}
