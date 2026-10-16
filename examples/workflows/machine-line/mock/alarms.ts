/**
 * Alarms: one retained topic per active alarm. Clearing publishes the
 * inactive record, then an empty retained payload so new subscribers see
 * nothing for that alarm.
 */

import { STOPPING_LEVELS, isoTs, type Level } from '../protocol';

export interface AlarmRecord {
  alarmId: string;
  code: string;
  level: Level;
  text: string;
  active: boolean;
  raisedAt: string;
  clearedAt: string | null;
  /** Who cleared it at the machine, when a person did. */
  clearedBy: string | null;
  ackedBy: string | null;
  ackedAt: string | null;
  zone: string | null;
  autoClears: boolean;
  action: string | null;
  jobId: string | null;
}

/** Where it happened, whether it clears without a person, what to do, which job it stopped. */
export interface AlarmContext {
  zone?: string;
  autoClears?: boolean;
  action?: string;
  jobId?: string | null;
}

export interface AlarmSink {
  publishAlarm(record: AlarmRecord): Promise<void>;
  clearRetainedAlarm(alarmId: string): Promise<void>;
}

export class Alarms {
  private active = new Map<string, AlarmRecord>();
  private seq = 0;

  constructor(private readonly sink: AlarmSink, private readonly prefix: string, private readonly zone: string) {}

  async raise(code: string, level: Level, text: string, ctx: AlarmContext = {}): Promise<AlarmRecord> {
    const stops = STOPPING_LEVELS.includes(level);
    const record: AlarmRecord = {
      alarmId: `${this.prefix}-${String(++this.seq).padStart(4, '0')}`,
      code, level, text,
      active: true,
      raisedAt: isoTs(),
      clearedAt: null,
      clearedBy: null,
      ackedBy: null,
      ackedAt: null,
      zone: ctx.zone ?? this.zone,
      autoClears: ctx.autoClears ?? !stops,
      action: ctx.action ?? (stops ? 'Inspect and clear, then reset' : null),
      jobId: ctx.jobId ?? null,
    };
    this.active.set(record.alarmId, record);
    await this.sink.publishAlarm(record);
    return record;
  }

  async clear(alarmId: string, by: string | null = null): Promise<boolean> {
    const record = this.active.get(alarmId);
    if (!record) return false;
    this.active.delete(alarmId);
    await this.sink.publishAlarm({ ...record, active: false, clearedAt: isoTs(), clearedBy: by });
    await this.sink.clearRetainedAlarm(alarmId);
    return true;
  }

  async clearWhere(match: (r: AlarmRecord) => boolean, by: string | null = null): Promise<string[]> {
    const ids = [...this.active.values()].filter(match).map((r) => r.alarmId);
    for (const id of ids) await this.clear(id, by);
    return ids;
  }

  async acknowledge(alarmId: string, by: string): Promise<boolean> {
    const record = this.active.get(alarmId);
    if (!record) return false;
    record.ackedBy = by;
    record.ackedAt = isoTs();
    await this.sink.publishAlarm(record);
    return true;
  }

  /** Forget every alarm without publishing (a controller restart). */
  reset(): void {
    this.active.clear();
  }

  list(): AlarmRecord[] {
    return [...this.active.values()];
  }

  stopsWork(): boolean {
    return this.list().some((r) => STOPPING_LEVELS.includes(r.level));
  }
}
