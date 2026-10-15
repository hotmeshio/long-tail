import { DateValue } from './DateValue';
import { UserName } from './UserName';
import { formatAgoCompact } from '../../../lib/format';
import { formatDisplayDateTime } from '../../../lib/display-zone';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export const EM_DASH = '—';

/** Value formats an author may name on a column, card field, or fact. `ago` is the spoken form of `age`. */
export const FIELD_FORMATS = {
  AGE: 'age',
  AGO: 'ago',
  DATE: 'date',
  USER: 'user',
} as const;

/** True when the format renders as an age that ages with the clock. */
export function isAgeFormat(format?: string): boolean {
  return format === FIELD_FORMATS.AGE || format === FIELD_FORMATS.AGO;
}

/**
 * Render a value with a little care: `age`/`ago` turns a timestamp into a
 * compact age ("12m", "3h") with the absolute time as its tooltip; `date`
 * renders the full date, hoverable, and so does any ISO datetime with no
 * format; `user` resolves a user id to a display name; an empty value a quiet
 * em dash; anything else plain text.
 */
export function FormattedValue({ raw, format }: { raw: string; format?: string }) {
  if (!raw || raw === EM_DASH) return <span className="text-text-quaternary">{EM_DASH}</span>;
  if (format === FIELD_FORMATS.USER) return <UserName userId={raw} className="block truncate" />;
  const isDate = ISO_DATETIME.test(raw) || !Number.isNaN(new Date(raw).getTime()) && (isAgeFormat(format) || format === FIELD_FORMATS.DATE);
  if (isAgeFormat(format) && isDate) {
    return <span title={formatDisplayDateTime(raw)} className="tabular-nums whitespace-nowrap">{formatAgoCompact(raw)}</span>;
  }
  if (isDate && (format === FIELD_FORMATS.DATE || ISO_DATETIME.test(raw))) {
    return <DateValue date={raw} format="datetime" className="text-text-primary whitespace-nowrap" />;
  }
  return <>{raw}</>;
}
