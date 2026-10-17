/**
 * Mock line settings. Cycle times and cadences are in seconds; `msPerSec`
 * scales every one of them, so tests run a full line in well under a second
 * and a demo runs at floor pace.
 */

export interface MockSettings {
  topicRoot: string;
  /** Milliseconds per simulated second (1000 = real time). */
  msPerSec: number;
  /** Machines boot enabled (otherwise they need the enable op). */
  startEnabled: boolean;
  /** A unit dispatched with no sender (line entry) arrives by itself. */
  autoArriveAtEntry: boolean;
  arrivalDelaySec: number;
  /** Carrier travel time between cells. */
  transferSec: number;
  /** A receiver waits this long for a released unit before reporting an incomplete handshake. */
  handshakeTimeoutSec: number;
  /** Periodic presence and snapshot republishing. */
  heartbeats: boolean;
  /** Telemetry cadence; 0 disables it. */
  telemetrySec: number;
  /** Random reject rate when nothing is armed. */
  failRate: number;
  queueCapacity: number;
}

export const DEFAULT_MOCK_SETTINGS: MockSettings = {
  topicRoot: 'line/v1',
  msPerSec: 1000,
  startEnabled: false,
  autoArriveAtEntry: true,
  arrivalDelaySec: 1,
  transferSec: 2,
  handshakeTimeoutSec: 10,
  heartbeats: true,
  telemetrySec: 1,
  failRate: 0,
  queueCapacity: 8,
};

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`mock setting "${raw}" must be a non-negative number`);
  return n;
}

export function mockSettingsFromEnv(env: Record<string, string | undefined> = process.env): MockSettings {
  const d = DEFAULT_MOCK_SETTINGS;
  return {
    topicRoot: env.MACHINE_TOPIC_ROOT ?? d.topicRoot,
    msPerSec: num(env.MOCK_LINE_MS_PER_SEC, d.msPerSec),
    startEnabled: (env.MOCK_LINE_START_ENABLED ?? String(d.startEnabled)) === 'true',
    autoArriveAtEntry: (env.MOCK_LINE_AUTO_ARRIVE ?? String(d.autoArriveAtEntry)) === 'true',
    arrivalDelaySec: num(env.MOCK_LINE_ARRIVAL_DELAY_SEC, d.arrivalDelaySec),
    transferSec: num(env.MOCK_LINE_TRANSFER_SEC, d.transferSec),
    handshakeTimeoutSec: num(env.MOCK_LINE_HANDSHAKE_TIMEOUT_SEC, d.handshakeTimeoutSec),
    heartbeats: (env.MOCK_LINE_HEARTBEATS ?? 'true') === 'true',
    telemetrySec: num(env.MOCK_LINE_TELEMETRY_SEC, d.telemetrySec),
    failRate: num(env.MOCK_LINE_FAIL_RATE, d.failRate),
    queueCapacity: num(env.MOCK_LINE_QUEUE_CAPACITY, d.queueCapacity),
  };
}

/** Timers owned by one machine, cleared together on stop. */
export class TimerBag {
  private handles = new Set<NodeJS.Timeout>();

  after(ms: number, fn: () => void): NodeJS.Timeout {
    const handle = setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    this.handles.add(handle);
    return handle;
  }

  every(ms: number, fn: () => void): NodeJS.Timeout {
    const handle = setInterval(fn, ms);
    this.handles.add(handle);
    return handle;
  }

  cancel(handle: NodeJS.Timeout | undefined): void {
    if (!handle) return;
    clearTimeout(handle);
    clearInterval(handle);
    this.handles.delete(handle);
  }

  clear(): void {
    for (const h of this.handles) {
      clearTimeout(h);
      clearInterval(h);
    }
    this.handles.clear();
  }
}
