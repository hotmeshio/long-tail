/**
 * One simulated machine: its MQTT link (birth, will, heartbeat, and an
 * outbox that holds reliable messages while the link is down), its mode,
 * the retained snapshot and telemetry. The station itself lives in Cell.
 */

import {
  CHANNEL, MODE, PRESENCE_HEARTBEAT_SEC, PRODUCTIVE_MODES, QOS, SNAPSHOT_HEARTBEAT_SEC,
  alarmTopic, buildEnvelope, clientIdOf, machineTopic, parsePayload,
  type MachineIdent, type Mode,
} from '../../../../lib/machines/protocol';
import { randomUUID } from 'crypto';

import { identOf, type LineDef, type MachineDef } from '../../../../lib/machines/line';
import type { MachineLink } from '../../../../lib/machines/transport';
import { Alarms, type AlarmRecord } from './alarms';
import { Cell } from './cell';
import { CommandHandler } from './commands';
import type { Floor } from './floor';
import type { PayloadStore } from './payloads';
import { TimerBag, type MockSettings } from './settings';

interface Outgoing { topic: string; payload: string; qos: 0 | 1; retain: boolean }

export class MockMachine {
  readonly ident: MachineIdent;
  readonly clientId: string;
  readonly alarms: Alarms;
  readonly cell = new Cell(this);
  commands = new CommandHandler(this);
  bootId = randomUUID();
  readonly timers = new TimerBag();
  readonly recipes: Record<string, string[]>;
  mode: Mode = MODE.IDLE;
  enabled: boolean;
  counters = { cycles: 0, ok: 0, rejected: 0 };
  queuedWhileOffline = 0;
  private beats = new TimerBag();
  private recipe: { id: string; version: string } | null = null;
  private outbox: Outgoing[] = [];
  private snapshotQueued = false;

  constructor(
    readonly def: MachineDef,
    line: LineDef,
    readonly link: MachineLink,
    readonly floor: Floor,
    readonly payloads: PayloadStore,
    readonly settings: MockSettings,
  ) {
    this.ident = identOf(line, def.machineId);
    this.clientId = clientIdOf(this.ident);
    this.enabled = settings.startEnabled;
    this.recipes = structuredClone(def.recipes);
    this.alarms = new Alarms({
      publishAlarm: async (r: AlarmRecord) => {
        await this.publishRaw(alarmTopic(this.root, this.ident, r.alarmId), this.wrap(r), QOS.RELIABLE, r.active);
        this.snapshotChanged();
      },
      clearRetainedAlarm: (id: string) => this.publishRaw(alarmTopic(this.root, this.ident, id), '', QOS.RELIABLE, true),
    }, `ALM-${def.machineId}`, def.machineId);
  }

  get root(): string {
    return this.settings.topicRoot;
  }

  ms(sec: number): number {
    return sec * this.settings.msPerSec;
  }

  async start(): Promise<void> {
    await this.connect();
    await this.publishSnapshot();
    if (this.settings.heartbeats) {
      this.beats.every(this.ms(PRESENCE_HEARTBEAT_SEC), () => void this.publishPresence(true));
      this.beats.every(this.ms(SNAPSHOT_HEARTBEAT_SEC), () => void this.publishSnapshot());
    }
    if (this.settings.telemetrySec > 0) this.beats.every(this.ms(this.settings.telemetrySec), () => void this.publishTelemetry());
  }

  async stop(): Promise<void> {
    this.beats.clear();
    this.timers.clear();
    if (this.link.connected) await this.network('graceful');
  }

  get software(): string {
    return this.def.software ?? '1.0.0';
  }

  /** The machine controller restarts: queue, station, alarms and command memory are lost. */
  async restart(): Promise<void> {
    if (this.link.connected) await this.link.disconnect(false);
    this.cell.forget();
    this.floor.forgetSender(this.def.machineId);
    this.alarms.reset();
    this.commands = new CommandHandler(this);
    this.mode = MODE.IDLE;
    this.recipe = null;
    this.bootId = randomUUID();
    await this.connect();
    await this.publishSnapshot();
  }

  /** drop: the link is lost (the will fires); restore: reconnect; graceful: say offline first. */
  async network(mode: 'drop' | 'restore' | 'graceful'): Promise<void> {
    if (mode === 'restore') return this.connect();
    if (mode === 'graceful') await this.publishPresence(false);
    await this.link.disconnect(mode === 'graceful');
  }

  canProduce(): boolean {
    return this.enabled && PRODUCTIVE_MODES.includes(this.mode) && !this.alarms.stopsWork();
  }

  async enable(on: boolean): Promise<void> {
    this.enabled = on;
    this.snapshotChanged();
    if (on) await this.resumeWork();
  }

  async resumeWork(): Promise<void> {
    if (!this.alarms.stopsWork()) this.floor.unblock(this.def.machineId);
    await this.cell.maybeStart();
    this.floor.poke();
  }

  async setMode(next: Mode): Promise<void> {
    if (next === this.mode) return;
    this.mode = next;
    this.snapshotChanged();
  }

  recipeKey(): string | null {
    return this.recipe ? `${this.recipe.id}@${this.recipe.version}` : null;
  }

  loadRecipe(recipe: { id: string; version: string }): void {
    this.recipe = { ...recipe };
  }

  /** Change over to a recipe version it holds: changeover mode until it is loaded, then idle. */
  async changeover(recipe: { id: string; version: string }): Promise<string | null> {
    if (!this.recipes[recipe?.id]?.includes(String(recipe?.version))) return `recipe ${recipe?.id} v${recipe?.version} is not held`;
    if (!PRODUCTIVE_MODES.includes(this.mode)) return `cannot change over in ${this.mode}`;
    await this.setMode(MODE.CHANGEOVER);
    this.timers.after(this.ms(this.def.changeoverSec), () => void (async () => {
      if (this.mode !== MODE.CHANGEOVER) return;
      this.loadRecipe({ id: recipe.id, version: String(recipe.version) });
      await this.setMode(MODE.IDLE);
      await this.resumeWork();
    })());
    return null;
  }

  recordCycle(ok: boolean): void {
    this.counters.cycles++;
    if (ok) this.counters.ok++;
    else this.counters.rejected++;
  }

  /** One reading per configured measurement; a rejected unit pushes the first out of range. */
  measure(ok: boolean): Record<string, any>[] {
    const breakAt = ok ? -1 : this.def.measurements.findIndex((x) => x.max != null);
    return this.def.measurements.map((x, i) => {
      const noise = (Math.random() * 2 - 1) * (x.noise ?? 0);
      const raw = i === breakAt ? x.max! + Math.abs(x.noise ?? 1) + 0.01 : x.target + noise;
      const value = Math.round(raw * 1000) / 1000;
      const min = x.min ?? null;
      const max = x.max ?? null;
      return { name: x.name, value, unit: x.unit ?? null, min, max, ok: min === null || max === null || (min <= value && value <= max) };
    });
  }

  /** Republish the retained snapshot once per tick of changes. */
  snapshotChanged(): void {
    if (this.snapshotQueued) return;
    this.snapshotQueued = true;
    queueMicrotask(() => {
      this.snapshotQueued = false;
      void this.publishSnapshot();
    });
  }

  async publishSnapshot(): Promise<void> {
    await this.publish(CHANNEL.SNAPSHOT, {
      bootId: this.bootId,
      software: this.software,
      mode: this.mode,
      enabled: this.enabled,
      recipe: this.recipe,
      jobs: [...this.cell.jobs.values()].map((j) => ({ jobId: j.jobId, units: j.units.map((u) => u.unitId), status: j.status })),
      alarms: this.alarms.list().map((a) => a.alarmId),
      cycles: this.counters.cycles,
    }, { retain: true });
  }

  publishJob(body: Record<string, any>): Promise<void> {
    return this.publish(CHANNEL.JOB, body);
  }

  publishReply(body: { cmdId: string; status: string; reason: string }): Promise<void> {
    return this.publish(CHANNEL.REPLY, body);
  }

  async publish(channel: string, body: Record<string, any>, opts: { qos?: 0 | 1; retain?: boolean } = {}): Promise<void> {
    await this.publishRaw(machineTopic(this.root, this.ident, channel), this.wrap(body), opts.qos ?? QOS.RELIABLE, opts.retain ?? false);
  }

  snapshot(): Record<string, any> {
    return {
      machineId: this.def.machineId, clientId: this.clientId, bootId: this.bootId, software: this.software, mode: this.mode, enabled: this.enabled,
      link: { connected: this.link.connected, queuedWhileOffline: this.queuedWhileOffline, outbox: this.outbox.length },
      recipe: this.recipe, station: this.cell.station, jobs: [...this.cell.jobs.values()],
      alarms: this.alarms.list(), counters: this.counters, replyMode: this.commands.replyMode,
    };
  }

  private publishPresence(online: boolean): Promise<void> {
    return this.publish(CHANNEL.PRESENCE, online ? { online, software: this.software } : { online }, { retain: true });
  }

  private publishTelemetry(): Promise<void> {
    const readings: Record<string, number> = { cycles: this.counters.cycles, ok: this.counters.ok, rejected: this.counters.rejected };
    for (const x of this.def.measurements) readings[x.name] = Math.round((x.target + (Math.random() * 2 - 1) * (x.noise ?? 0)) * 1000) / 1000;
    return this.publish(CHANNEL.TELEMETRY, { readings }, { qos: QOS.BEST_EFFORT });
  }

  private wrap(body: Record<string, any>): string {
    return JSON.stringify(buildEnvelope(this.ident, body));
  }

  private async publishRaw(topic: string, payload: string, qos: 0 | 1, retain: boolean): Promise<void> {
    if (!this.link.connected) {
      if (qos === QOS.RELIABLE) {
        this.outbox.push({ topic, payload, qos, retain });
        this.queuedWhileOffline++;
      }
      return;
    }
    await this.link.publish(topic, payload, { qos, retain });
  }

  private async connect(): Promise<void> {
    const will = { topic: machineTopic(this.root, this.ident, CHANNEL.PRESENCE), payload: this.wrap({ online: false }), retain: true };
    await this.link.connect({ clientId: this.clientId, will, onRestored: () => void this.announce() });
    await this.link.subscribe(machineTopic(this.root, this.ident, CHANNEL.CMD), (msg) => {
      void this.commands.handle(parsePayload(msg.payload));
    });
    await this.announce();
  }

  /** Birth, then whatever reliable messages waited for the link. */
  private async announce(): Promise<void> {
    await this.publishPresence(true);
    const pending = this.outbox.splice(0);
    for (const o of pending) await this.link.publish(o.topic, o.payload, { qos: o.qos, retain: o.retain });
  }
}
