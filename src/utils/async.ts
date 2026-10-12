/** Reject with `message` if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Run `fn`, swallowing any exception (for best-effort cleanup). */
export function safe(fn: () => void) {
  try {
    fn();
  } catch {
    /* ignore */
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const errorDetail = (e: unknown) => (e instanceof Error ? e.stack ?? e.message : String(e));
