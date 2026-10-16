/**
 * The whole simulated line: one MockMachine per machine in the line config,
 * the shared floor and the payload store for job artifacts, plus the drill
 * operations the HTTP surface exposes.
 */

import { LEVEL, type Level } from '../protocol';
import { machineById, type LineDef } from '../line';
import type { MachineLink } from '../transport';
import type { ArmedResult } from './cell';
import { REPLY_MODE, type ReplyMode } from './commands';
import { Floor, TRANSFER_FAULT, type TransferFault } from './floor';
import * as hmi from './hmi';
import { MockMachine } from './machine';
import { PayloadStore } from './payloads';
import type { MockSettings } from './settings';

export class MockLine {
  readonly machines = new Map<string, MockMachine>();
  readonly floor: Floor;
  readonly payloads: PayloadStore;
  readonly line: LineDef;

  constructor(line: LineDef, readonly settings: MockSettings, linkFor: (machineId: string) => MachineLink, payloadBaseUrl?: string) {
    this.line = structuredClone(line);
    this.floor = new Floor(settings);
    this.payloads = new PayloadStore(payloadBaseUrl);
    for (const def of this.line.machines) {
      this.machines.set(def.machineId, new MockMachine(def, this.line, linkFor(def.machineId), this.floor, this.payloads, settings));
    }
  }

  async start(): Promise<void> {
    for (const m of this.machines.values()) await m.start();
  }

  async stop(): Promise<void> {
    this.floor.shutdown();
    for (const m of this.machines.values()) await m.stop();
  }

  machine(machineId: string): MockMachine {
    machineById(this.line, machineId);
    return this.machines.get(machineId)!;
  }

  state(): Record<string, any> {
    return { siteId: this.line.siteId, lineId: this.line.lineId, machines: [...this.machines.values()].map((m) => m.snapshot()) };
  }

  /** The machine gives up a queued job by itself. */
  async withdraw(machineId: string, input: { jobId: string }): Promise<boolean> {
    const m = this.machine(machineId);
    const job = m.cell.jobs.get(input.jobId);
    if (!job || job.status !== 'queued') return false;
    await m.cell.withdraw(job);
    return true;
  }

  restart(machineId: string): Promise<void> {
    return this.machine(machineId).restart();
  }

  arrive(machineId: string, input: { unitId: string; carrierId?: string | null }): Promise<boolean> {
    return this.floor.arrive(this.machine(machineId), input.unitId, input.carrierId ?? null);
  }

  arm(machineId: string, input: ArmedResult & { count?: number }): number {
    const m = this.machine(machineId);
    const count = Math.max(1, Number(input.count ?? 1));
    for (let i = 0; i < count; i++) m.cell.armed.push({ result: input.result, reason: input.reason });
    return m.cell.armed.length;
  }

  armTransfer(machineId: string, input: { fault: TransferFault }): void {
    if (!Object.values(TRANSFER_FAULT).includes(input.fault)) throw new Error(`unknown transfer fault ${input.fault}`);
    this.machine(machineId);
    this.floor.arm(machineId, input.fault);
  }

  async alarm(machineId: string, input: { code: string; level?: Level; text?: string }): Promise<string> {
    const record = await this.machine(machineId).alarms.raise(input.code, input.level ?? LEVEL.WARNING, input.text ?? input.code);
    return record.alarmId;
  }

  clearAlarm(machineId: string, input: { alarmId: string; by?: string }): Promise<boolean> {
    return hmi.clearAlarm(this.machine(machineId), input.alarmId, input.by ?? null);
  }

  fault(machineId: string, input: { code: string }): Promise<string> {
    return hmi.fault(this.machine(machineId), input);
  }

  emergencyStop(machineId: string): Promise<string> {
    return hmi.emergencyStop(this.machine(machineId));
  }

  reset(machineId: string, input: { by?: string } = {}): Promise<void> {
    return hmi.reset(this.machine(machineId), input.by ?? null);
  }

  maintenanceStart(machineId: string): Promise<void> {
    return hmi.maintenanceStart(this.machine(machineId));
  }

  maintenanceEnd(machineId: string, input: { by?: string } = {}): Promise<void> {
    return hmi.maintenanceEnd(this.machine(machineId), input.by ?? null);
  }

  recipes(machineId: string, input: { id: string; version: string }): Record<string, string[]> {
    const m = this.machine(machineId);
    const held = m.recipes[input.id] ?? [];
    if (!held.includes(String(input.version))) m.recipes[input.id] = [...held, String(input.version)];
    return m.recipes;
  }

  network(machineId: string, input: { mode: 'drop' | 'restore' | 'graceful' }): Promise<void> {
    return this.machine(machineId).network(input.mode);
  }

  config(machineId: string, input: { replyMode?: ReplyMode; replyDelaySec?: number; cycleSec?: number }): Record<string, any> {
    const m = this.machine(machineId);
    if (input.replyMode !== undefined) {
      if (!Object.values(REPLY_MODE).includes(input.replyMode)) throw new Error(`unknown replyMode ${input.replyMode}`);
      m.commands.replyMode = input.replyMode;
    }
    if (input.replyDelaySec !== undefined) m.commands.replyDelayMs = m.ms(Number(input.replyDelaySec));
    if (input.cycleSec !== undefined) m.def.cycleSec = Number(input.cycleSec);
    return { replyMode: m.commands.replyMode, replyDelayMs: m.commands.replyDelayMs, cycleSec: m.def.cycleSec };
  }

  unload(machineId: string, input: { unitId: string }): Promise<boolean> {
    return this.machine(machineId).cell.unload(input.unitId);
  }
}
