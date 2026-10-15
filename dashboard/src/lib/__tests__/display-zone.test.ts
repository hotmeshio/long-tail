import { describe, it, expect, afterEach } from 'vitest';
import { formatDisplayDateTime, setDisplayTimeZone, getDisplayTimeZone } from '../display-zone';

const INSTANT = '2026-10-13T06:02:02.619Z';

afterEach(() => setDisplayTimeZone(null));

describe('display time zone', () => {
  it('formats in the deployment zone when one is set', () => {
    setDisplayTimeZone('America/Chicago');
    expect(getDisplayTimeZone()).toBe('America/Chicago');
    expect(formatDisplayDateTime(INSTANT)).toBe('Oct 13, 2026 1:02 AM');
    expect(formatDisplayDateTime(INSTANT, true)).toBe('Oct 13, 2026 1:02:02 AM');
    setDisplayTimeZone('Asia/Tokyo');
    expect(formatDisplayDateTime(INSTANT)).toBe('Oct 13, 2026 3:02 PM');
  });

  it('keeps the browser zone when unset, and passes an invalid date through', () => {
    setDisplayTimeZone(undefined);
    expect(getDisplayTimeZone()).toBeNull();
    expect(formatDisplayDateTime(INSTANT)).toMatch(/^Oct 1[23], 2026 \d{1,2}:02 (AM|PM)$/);
    expect(formatDisplayDateTime('not a date')).toBe('not a date');
  });
});
