import { describe, it, expect } from 'vitest';
import {
  isWorker,
  isThrottled,
  formatThrottleHuman,
  formatMemory,
  stripStreamPrefix,
  rowKey,
} from '../helpers';
import type { QuorumProfile } from '../../../../api/controlplane';

const baseProfile: QuorumProfile = {
  namespace: 'durable',
  app_id: 'durable',
  engine_id: 'HaBC123def456',
};

describe('control plane helpers', () => {
  describe('isWorker', () => {
    it('returns true when worker_topic is set', () => {
      expect(isWorker({ ...baseProfile, worker_topic: 'long-tail-system-mcpTriage' })).toBe(true);
    });

    it('returns false when worker_topic is absent', () => {
      expect(isWorker(baseProfile)).toBe(false);
    });
  });

  describe('isThrottled', () => {
    it('returns true when throttle is -1 (paused)', () => {
      expect(isThrottled({ ...baseProfile, throttle: -1 })).toBe(true);
    });

    it('returns true when throttle is positive', () => {
      expect(isThrottled({ ...baseProfile, throttle: 1000 })).toBe(true);
    });

    it('returns false when throttle is 0 (normal)', () => {
      expect(isThrottled({ ...baseProfile, throttle: 0 })).toBe(false);
    });

    it('returns false when throttle is undefined', () => {
      expect(isThrottled(baseProfile)).toBe(false);
    });
  });

  describe('formatThrottleHuman', () => {
    it('returns "Normal" for 0', () => {
      expect(formatThrottleHuman(0)).toBe('Normal');
    });

    it('returns "Normal" for undefined', () => {
      expect(formatThrottleHuman(undefined)).toBe('Normal');
    });

    it('returns "Paused" for -1', () => {
      expect(formatThrottleHuman(-1)).toBe('Paused');
    });

    it('formats milliseconds', () => {
      expect(formatThrottleHuman(500)).toBe('500ms');
    });

    it('formats seconds', () => {
      expect(formatThrottleHuman(5000)).toBe('5.0s');
    });

    it('formats minutes', () => {
      expect(formatThrottleHuman(90_000)).toBe('1.5m');
    });

    it('formats hours', () => {
      expect(formatThrottleHuman(7_200_000)).toBe('2.0h');
    });

    it('formats days', () => {
      expect(formatThrottleHuman(172_800_000)).toBe('2d');
    });
  });

  describe('formatMemory', () => {
    it('returns formatted used / total', () => {
      expect(formatMemory('8.0', '2.0')).toBe('6.0 / 8.0 GB');
    });

    it('returns — when total is missing', () => {
      expect(formatMemory(undefined, '2.0')).toBe('—');
    });

    it('returns — when free is missing', () => {
      expect(formatMemory('8.0', undefined)).toBe('—');
    });

    it('returns — for non-numeric values', () => {
      expect(formatMemory('abc', 'def')).toBe('—');
    });
  });

  describe('stripStreamPrefix', () => {
    it('strips hmsh:durable:x: prefix', () => {
      expect(stripStreamPrefix('hmsh:durable:x:long-tail-system-mcpTriage'))
        .toBe('long-tail-system-mcpTriage');
    });

    it('returns (engine) for the bare engine stream', () => {
      expect(stripStreamPrefix('hmsh:durable:x:')).toBe('(engine)');
    });

    it('handles other app IDs', () => {
      expect(stripStreamPrefix('hmsh:mycustomserver:x:my-topic'))
        .toBe('my-topic');
    });
  });

  describe('rowKey', () => {
    it('includes engine_id and worker_topic for workers', () => {
      const key = rowKey({ ...baseProfile, worker_topic: 'my-topic' });
      expect(key).toBe('HaBC123def456-my-topic');
    });

    it('uses "engine" suffix for engines', () => {
      const key = rowKey(baseProfile);
      expect(key).toBe('HaBC123def456-engine');
    });
  });
});
