import { describe, it, expect } from 'vitest';
import { formatDuration, formatDateTime, formatRemaining, formatTimeAgo } from '../format';

describe('formatDuration', () => {
  it('returns -- for null', () => expect(formatDuration(null)).toBe('--'));
  it('returns -- for undefined', () => expect(formatDuration(undefined)).toBe('--'));
  it('formats milliseconds', () => expect(formatDuration(500)).toBe('500ms'));
  it('formats seconds', () => expect(formatDuration(2500)).toBe('2.5s'));
  it('formats minutes', () => expect(formatDuration(90000)).toBe('1.5m'));
  it('formats zero', () => expect(formatDuration(0)).toBe('0ms'));
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
  it('formats seconds', () => expect(formatRemaining(45000)).toBe('45s'));
  it('formats minutes and seconds', () => expect(formatRemaining(125000)).toBe('2m 5s'));
  it('formats hours and minutes', () => expect(formatRemaining(3_720_000)).toBe('1h 2m'));
});

describe('formatTimeAgo', () => {
  it('returns "just now" for future dates', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatTimeAgo(future)).toBe('just now');
  });

  it('formats seconds', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatTimeAgo(recent)).toBe('30s ago');
  });

  it('formats minutes', () => {
    const ago = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(ago)).toBe('5m ago');
  });

  it('formats hours', () => {
    const ago = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatTimeAgo(ago)).toBe('3h ago');
  });

  it('formats days', () => {
    const ago = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(formatTimeAgo(ago)).toBe('7d ago');
  });
});
