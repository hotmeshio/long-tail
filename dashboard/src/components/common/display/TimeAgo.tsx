import { DateValue } from './DateValue';

/**
 * Relative time display ("5 minutes ago").
 * Thin wrapper around DateValue for backward compatibility.
 */
export function TimeAgo({ date, className = '' }: { date: string; className?: string }) {
  return <DateValue date={date} format="relative" className={className} />;
}
