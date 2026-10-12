import { ReactElement, cloneElement, useCallback, useLayoutEffect, useRef, useState } from 'react';
import './Tooltip.css';

interface Props {
  text: string;
  /** A single element that accepts mouse/focus handlers and a ref. */
  children: ReactElement;
}

const SHOW_DELAY_MS = 300;
const MARGIN = 4;

/**
 * Themed hover/focus tooltip (native `title` tooltips are slow and unreliable inside webviews).
 * Positioned below the target with `position: fixed` and clamped to the viewport.
 */
export function Tooltip({ text, children }: Props) {
  const targetRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !targetRef.current || !tipRef.current) return;
    const r = targetRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    let left = r.left + r.width / 2 - tip.width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tip.width - MARGIN));
    let top = r.bottom + MARGIN;
    if (top + tip.height > window.innerHeight - MARGIN) top = r.top - tip.height - MARGIN;
    setPos({ left, top });
  }, [open, text]);

  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => (targetRef.current = el),
    'aria-label': text,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onMouseDown: (e: React.MouseEvent) => {
      hide();
      children.props.onMouseDown?.(e);
    },
  });

  return (
    <>
      {child}
      {open && (
        <div ref={tipRef} role="tooltip" className="tooltip" style={pos}>
          {text}
        </div>
      )}
    </>
  );
}
