import { useCallback, useState } from 'react';

interface Options {
  initial: number;
  min: number;
  /** Space that must stay free for the other pane. */
  reserve: number;
  /** Where the splitter is: on the pane's left edge (pane docked right, the default) or its right edge. */
  edge?: 'left' | 'right';
  onCommit?: (width: number) => void;
}

/** Width of a pane controlled by dragging a splitter on one of its edges. */
export function useResizableWidth({ initial, min, reserve, onCommit, edge = 'left' }: Options) {
  const [width, setWidth] = useState(initial);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      let w = startW;
      const move = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        w = Math.max(min, Math.min(window.innerWidth - reserve, edge === 'left' ? startW - dx : startW + dx));
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
    [width, min, reserve, onCommit, edge],
  );

  return { width, setWidth, startDrag };
}
