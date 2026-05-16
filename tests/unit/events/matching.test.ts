import { describe, it, expect } from 'vitest';
import { subjectMatchesPattern } from '../../../lib/events/matching';

describe('subjectMatchesPattern', () => {
  it('matches exact strings', () => {
    expect(subjectMatchesPattern('task.created', 'task.created')).toBe(true);
    expect(subjectMatchesPattern('task.created', 'task.failed')).toBe(false);
  });

  it('global wildcard * matches everything', () => {
    expect(subjectMatchesPattern('task.created', '*')).toBe(true);
    expect(subjectMatchesPattern('app.vendor.orders.error', '*')).toBe(true);
  });

  it('single-token wildcard * matches one segment', () => {
    expect(subjectMatchesPattern('task.created', 'task.*')).toBe(true);
    expect(subjectMatchesPattern('task.failed', 'task.*')).toBe(true);
    expect(subjectMatchesPattern('workflow.started', 'task.*')).toBe(false);
  });

  it('single-token wildcard in the middle', () => {
    expect(subjectMatchesPattern('app.vendor.error', 'app.*.error')).toBe(true);
    expect(subjectMatchesPattern('app.billing.error', 'app.*.error')).toBe(true);
    expect(subjectMatchesPattern('app.vendor.success', 'app.*.error')).toBe(false);
  });

  it('multi-segment wildcard > matches rest of subject', () => {
    expect(subjectMatchesPattern('app.vendor.orders.error', 'app.>')).toBe(true);
    expect(subjectMatchesPattern('app.vendor.orders.sync', 'app.>')).toBe(true);
    expect(subjectMatchesPattern('app.x', 'app.>')).toBe(true);
    expect(subjectMatchesPattern('workflow.started', 'app.>')).toBe(false);
  });

  it('> must be last segment', () => {
    expect(subjectMatchesPattern('app.vendor.orders.error', 'app.vendor.>')).toBe(true);
    expect(subjectMatchesPattern('app.vendor.x', 'app.vendor.>')).toBe(true);
  });

  it('combined * and exact tokens', () => {
    expect(subjectMatchesPattern('app.vendor.orders.error', 'app.*.*.error')).toBe(true);
    expect(subjectMatchesPattern('app.billing.invoice.error', 'app.*.*.error')).toBe(true);
    expect(subjectMatchesPattern('app.vendor.error', 'app.*.*.error')).toBe(false); // only 3 segments, pattern has 4
    expect(subjectMatchesPattern('app.vendor.orders.success', 'app.*.*.error')).toBe(false);
  });

  it('pattern longer than subject does not match', () => {
    expect(subjectMatchesPattern('task', 'task.created')).toBe(false);
  });

  it('subject longer than pattern does not match (without >)', () => {
    expect(subjectMatchesPattern('task.created.extra', 'task.created')).toBe(false);
  });

  it('empty strings', () => {
    expect(subjectMatchesPattern('', '')).toBe(true);
    expect(subjectMatchesPattern('task', '')).toBe(false);
  });
});
