import { en, MessageKey } from './en';
import { zhCn } from './zh-cn';

const bundles: Record<string, Record<MessageKey, string>> = { en, 'zh-cn': zhCn };

let current: Record<MessageKey, string> = en;

/** Pick the bundle for a VS Code locale ("zh-cn", "zh-CN", "en-us" → closest match, default English). */
export function setLocale(locale: string | undefined) {
  const l = (locale ?? 'en').toLowerCase();
  current = bundles[l] ?? bundles[l.split('-')[0]] ?? (l.startsWith('zh') ? zhCn : en);
  document.documentElement.lang = l;
}

/** Translate `key`, substituting {0}, {1}, … */
export function t(key: MessageKey, ...args: (string | number)[]): string {
  return (current[key] ?? en[key]).replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}

export type { MessageKey };
