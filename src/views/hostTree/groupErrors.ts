import { t } from '../../i18n';
import { GroupError } from '../../storage/groupRepository';

/** User-facing text for a refused group change, or undefined if `e` is something else. */
export function groupErrorMessage(e: unknown): string | undefined {
  if (!(e instanceof GroupError)) return undefined;
  return {
    exists: () => t('A group with that name already exists here.'),
    cycle: () => t('A group cannot be moved into itself or one of its subgroups.'),
    notFound: () => t('That group no longer exists.'),
  }[e.reason]();
}
