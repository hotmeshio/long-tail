import { describe, it, expect } from 'vitest';
import { readTransitionConfig, readTransitionDone } from '../../../../shared/form-validation/x-lt-transition';

describe('readTransitionConfig', () => {
  it('returns null when the schema does not opt in', () => {
    expect(readTransitionConfig(null)).toBeNull();
    expect(readTransitionConfig(undefined)).toBeNull();
    expect(readTransitionConfig({})).toBeNull();
    expect(readTransitionConfig({ 'x-lt-transition': false })).toBeNull();
  });

  it('returns config with the declared message and clamped wait when opted in', () => {
    const cfg = readTransitionConfig({
      'x-lt-transition': true,
      'x-lt-transition-message': '**Saved.**',
      'x-lt-transition-max-wait-seconds': 45,
    });
    expect(cfg).toEqual({ message: '**Saved.**', maxWaitSeconds: 45 });
  });

  it('applies defaults for a bare opt-in', () => {
    const cfg = readTransitionConfig({ 'x-lt-transition': true });
    expect(cfg?.maxWaitSeconds).toBe(30);
    expect(typeof cfg?.message).toBe('string');
    expect((cfg?.message ?? '').length).toBeGreaterThan(0);
  });

  it('clamps out-of-range or invalid wait values', () => {
    expect(readTransitionConfig({ 'x-lt-transition': true, 'x-lt-transition-max-wait-seconds': 1 })?.maxWaitSeconds).toBe(5);
    expect(readTransitionConfig({ 'x-lt-transition': true, 'x-lt-transition-max-wait-seconds': 9999 })?.maxWaitSeconds).toBe(300);
    expect(readTransitionConfig({ 'x-lt-transition': true, 'x-lt-transition-max-wait-seconds': -3 })?.maxWaitSeconds).toBe(30);
    expect(readTransitionConfig({ 'x-lt-transition': true, 'x-lt-transition-max-wait-seconds': 'nope' as unknown })?.maxWaitSeconds).toBe(30);
  });

  it('falls back to the default message when the declared one is blank', () => {
    const cfg = readTransitionConfig({ 'x-lt-transition': true, 'x-lt-transition-message': '   ' });
    expect((cfg?.message ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('readTransitionDone', () => {
  it('returns the raw destination template independent of x-lt-transition', () => {
    expect(readTransitionDone({ 'x-lt-transition-done': '/escalations/available?role=r' }))
      .toBe('/escalations/available?role=r');
    // No x-lt-transition needed — a terminal step declares only the destination.
    expect(readTransitionDone({ 'x-lt-transition': true, 'x-lt-transition-done': '/home' })).toBe('/home');
  });

  it('returns null when absent or blank', () => {
    expect(readTransitionDone(null)).toBeNull();
    expect(readTransitionDone({})).toBeNull();
    expect(readTransitionDone({ 'x-lt-transition-done': '   ' })).toBeNull();
    expect(readTransitionDone({ 'x-lt-transition-done': 123 as unknown as string })).toBeNull();
  });
});
