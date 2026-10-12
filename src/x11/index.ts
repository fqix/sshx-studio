import { t } from '../i18n';
import { parseDisplay } from './display';
import { X11Forwarder } from './x11Forwarder';
import { readXauthCookie } from './xauth';

export { X11Forwarder } from './x11Forwarder';

/** X11 forwarding to this machine's display, or an explanation of why it isn't possible. */
export function createX11Forwarder(log: (m: string) => void): X11Forwarder | { unavailable: string } {
  const display = parseDisplay();
  if (!display) return { unavailable: t('X11 forwarding needs a local X server (DISPLAY is not set; on macOS install XQuartz).') };
  const cookie = readXauthCookie(display.display);
  log(`X11: forwarding to ${display.display}${cookie ? ' (xauth cookie found)' : ' (no xauth cookie)'}`);
  return new X11Forwarder(display, cookie, log);
}
