import { useEffect, useRef } from 'react';
import type { HostMessage } from '@shared/protocol';

/** Subscribe to messages from the extension host. The latest `handler` is always used. */
export function useHostMessage(handler: (msg: HostMessage) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (ev: MessageEvent<HostMessage>) => ref.current(ev.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
