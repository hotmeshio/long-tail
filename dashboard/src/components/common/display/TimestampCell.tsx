import { DateValue } from './DateValue';

interface TimestampCellProps {
  date: string;
}

/**
 * Standard timestamp cell for data tables.
 * Shows friendly "ago" text with UTC timestamp below.
 */
export function TimestampCell({ date }: TimestampCellProps) {
  return (
    <div>
      <DateValue date={date} format="relative" />
      <p className="text-[9px] font-mono text-text-secondary mt-0.5 whitespace-nowrap">
        {new Date(date).toISOString().replace('T', ' ').slice(0, 19)} UTC
      </p>
    </div>
  );
}
