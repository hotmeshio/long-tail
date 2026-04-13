import { describe, it, expect } from 'vitest';
import { formatDuration, formatDateTime, formatRemaining, formatTimeAgo, formatDurationCompact, formatElapsed } from '../format';

describe('formatDuration', () => {
  it('returns -- for null', () => expect(formatDuration(null)).toBe('--'));
  it('returns -- for undefined', () => expect(formatDuration(undefined)).toBe('--'));
  it('formats milliseconds', () => expect(formatDuration(500)).toBe('500ms'));
  it('formats seconds', () => expect(formatDuration(2500)).toBe('2.5s'));
  it('formats minutes and seconds', () => expect(formatDuration(90_000)).toBe('1m 30s'));
  it('formats hours and minutes', () => expect(formatDuration(5_520_000)).toBe('1h 32m'));
  it('formats days and hours', () => expect(formatDuration(90_000_000)).toBe('1d 1h'));
  it('formats zero', () => expect(formatDuration(0)).toBe('0ms'));
  it('formats exact minutes', () => expect(formatDuration(120_000)).toBe('2m'));
  it('formats exact hours', () => expect(formatDuration(3_600_000)).toBe('1h'));
  it('formats exact days', () => expect(formatDuration(86_400_000)).toBe('1d'));
  it('formats 632 minutes as 10h 32m', () => expect(formatDuration(632 * 60_000)).toBe('10h 32m'));
});

describe('formatDurationCompact', () => {
  it('formats sub-second', () => expect(formatDurationCompact(250)).toBe('250ms'));
  it('formats seconds with decimal', () => expect(formatDurationCompact(1500)).toBe('1.5s'));
  it('formats multi-day durations', () => expect(formatDurationCompact(172_800_000)).toBe('2d'));
  it('formats days + hours', () => expect(formatDurationCompact(180_000_000)).toBe('2d 2h'));
});

describe('formatDateTime', () => {
  it('returns -- for null', () => expect(formatDateTime(null)).toBe('--'));
  it('formats ISO string', () => {
    const result = formatDateTime('2024-01-15T10:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('--');
  });
});

describe('formatRemaining', () => {
  it('returns Expired for zero', () => expect(formatRemaining(0)).toBe('Expired'));
  it('returns Expired for negative', () => expect(formatRemaining(-1000)).toBe('Expired'));
  it('formats seconds', () => expect(formatRemaining(45_000)).toBe('45s'));
  it('formats minutes and seconds', () => expect(formatRemaining(125_000)).toBe('2m 5s'));
  it('formats hours and minutes', () => expect(formatRemaining(3_720_000)).toBe('1h 2m'));
});

describe('formatTimeAgo', () => {
  it('returns "just now" for future dates', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatTimeAgo(future)).toBe('just now');
  });

  it('formats recent past', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatTimeAgo(recent)).toMatch(/30 seconds ago/);
  });

  it('formats minutes ago', () => {
    const ago = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(ago)).toMatch(/5 minutes ago/);
  });

  it('formats hours ago', () => {
    const ago = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatTimeAgo(ago)).toMatch(/3 hours ago/);
  });

  it('formats days ago', () => {
    const ago = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(formatTimeAgo(ago)).toMatch(/7 days ago/);
  });
});

describe('formatElapsed', () => {
  it('formats elapsed from start to end', () => {
    const start = '2024-01-01T00:00:00Z';
    const end = '2024-01-01T01:30:00Z';
    expect(formatElapsed(start, end)).toBe('1h 30m');
  });

  it('formats running duration when end is null', () => {
    const start = new Date(Date.now() - 5000).toISOString();
    const result = formatElapsed(start, null);
    expect(result).toMatch(/\ds$/);
  });
});
