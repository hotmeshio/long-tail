import { describe, it, expect } from 'vitest';

import { isReplayable, nextSubject, replayable, subjectRef, type StationSubject } from '../scan-subject';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const held = (seconds: number): StationSubject => ({
  code: '11:0:K7Q2M9XA', escalationId: 'bag-row', label: 'K7Q2M9XA',
  expiresAt: new Date(NOW + seconds * 1000).toISOString(), ttlMs: 45_000,
});

describe('subjectRef', () => {
  it('sends the pointer while the subject is live, and nothing once it lapses', () => {
    expect(subjectRef(held(10), NOW)).toEqual({ code: '11:0:K7Q2M9XA', escalationId: 'bag-row' });
    expect(subjectRef(held(-1), NOW)).toBeUndefined();
    expect(subjectRef(null, NOW)).toBeUndefined();
  });
});

describe('nextSubject', () => {
  it('a hold replaces whatever was held (the last bag scanned wins)', () => {
    const next = nextSubject(held(10), {
      outcome: 'held',
      subject: { code: '11:0:B', escalationId: 'bag-b', label: 'B', expiresAt: new Date(NOW + 30_000).toISOString() },
    }, NOW);
    expect(next).toMatchObject({ escalationId: 'bag-b', ttlMs: 30_000 });
  });

  it('a clear drops it; an unrelated answer leaves it', () => {
    expect(nextSubject(held(10), { outcome: 'executed', clearSubject: true }, NOW)).toBeNull();
    expect(nextSubject(held(10), { outcome: 'refused' }, NOW)?.escalationId).toBe('bag-row');
    expect(nextSubject(held(10), { outcome: 'identity_primed' }, NOW)?.escalationId).toBe('bag-row');
  });

  it('a fill with items left extends the hold by its own span', () => {
    const next = nextSubject(held(2), { outcome: 'executed', progress: { filled: 1, total: 3, remaining: 2 } }, NOW);
    expect(Date.parse(next!.expiresAt)).toBe(NOW + 45_000);
  });
});

describe('replay', () => {
  it('only a replayable not-primed waits for the badge, and only for 30 s', () => {
    expect(isReplayable({ outcome: 'not_primed', replayable: true })).toBe(true);
    expect(isReplayable({ outcome: 'not_primed' })).toBe(false);
    expect(replayable({ code: '14:0:SF-A-2', at: NOW - 10_000 }, NOW)?.code).toBe('14:0:SF-A-2');
    expect(replayable({ code: '14:0:SF-A-2', at: NOW - 31_000 }, NOW)).toBeNull();
  });
});
