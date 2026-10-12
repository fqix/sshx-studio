import { useCallback, useState } from 'react';

interface Options {
  initial: number;
  min: number;
  /** Space that must stay free for the other pane. */
  reserve: number;
  onCommit?: (width: number) => void;
}

/** Width of a right-docked pane controlled by dragging a splitter on its left edge. */
export function useResizableWidth({ initial, min, reserve, onCommit }: Options) {
  const [width, setWidth] = useState(initial);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      let w = startW;
      const move = (ev: MouseEvent) => {
        w = Math.max(min, Math.min(window.innerWidth - reserve, startW - (ev.clientX - startX)));
        setWidth(w);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing');
        onCommit?.(w);
      };
      document.body.classList.add('resizing');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [width, min, reserve, onCommit],
  );

  return { width, startDrag };
}
