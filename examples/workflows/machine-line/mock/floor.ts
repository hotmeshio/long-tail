/**
 * The floor between stations: where each finished unit waits, which station
 * expects it, and the carrier transfer that joins them. A receiver says READY
 * when its station is clear; the sender says RELEASED; after the travel time
 * the receiver confirms ARRIVED. Faults armed on either side are spent on the
 * next transfer that involves it.
 */

import { JOB_EVENT, LEVEL, TRANSFER_FAILURE } from '../protocol';
import type { Job } from './cell';
import type { MockMachine } from './machine';
import type { MockSettings } from './settings';

export const TRANSFER_FAULT = {
  /** The sender reports a jam and blocks until its alarm clears. */
  JAM: 'jam',
  /** The unit leaves the sender and never confirms at the receiver. */
  INCOMPLETE: 'incomplete',
  /** The receiver reads a different carrier than the one dispatched. */
  CARRIER_MISMATCH: 'carrier_mismatch',
  /** Nothing happens and nothing is reported. */
  STALL: 'stall',
} as const;
export type TransferFault = typeof TRANSFER_FAULT[keyof typeof TRANSFER_FAULT];

interface Expectation { receiver: MockMachine; job: Job; announced: boolean; stalled: boolean }
interface Holding { sender: MockMachine | null; job: Job; carrierId: string | null }

export class Floor {
  private expects = new Map<string, Expectation>();
  private holds = new Map<string, Holding>();
  private armed = new Map<string, TransferFault[]>();
  private blocked = new Set<string>();
  private inbound = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly settings: MockSettings) {}

  /** A station accepted a dispatch for this unit. */
  expect(receiver: MockMachine, job: Job): void {
    this.expects.set(job.unitId, { receiver, job, announced: false, stalled: false });
    if (!job.from && !this.holds.has(job.unitId)) this.holds.set(job.unitId, { sender: null, job, carrierId: job.carrierId });
    this.poke();
  }

  unexpect(unitId: string): void {
    this.expects.delete(unitId);
  }

  /** A finished unit waits at its station for the next one. */
  hold(sender: MockMachine, job: Job, carrierId: string | null): void {
    this.holds.set(job.unitId, { sender, job, carrierId });
    this.poke();
  }

  drop(unitId: string): void {
    this.holds.delete(unitId);
  }

  arm(machineId: string, fault: TransferFault): void {
    this.armed.set(machineId, [...(this.armed.get(machineId) ?? []), fault]);
  }

  unblock(machineId: string): void {
    if (this.blocked.delete(machineId)) this.poke();
  }

  /** Re-check every expectation, one at a time; called whenever a station or unit moves. */
  poke(): void {
    this.chain = this.chain.then(async () => {
      for (const unitId of [...this.expects.keys()]) await this.attempt(unitId).catch(() => undefined);
    });
  }

  /** Resolves once queued transfer attempts have run. */
  settled(): Promise<void> {
    return this.chain;
  }

  /** Deliver a unit by hand (line entry when auto arrival is off). */
  async arrive(receiver: MockMachine, unitId: string, carrierId: string | null): Promise<boolean> {
    this.holds.delete(unitId);
    const ok = await receiver.cell.receive(unitId, carrierId, null);
    if (ok) this.expects.delete(unitId);
    return ok;
  }

  shutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private takeFault(machine: MockMachine | null): TransferFault | undefined {
    return machine ? this.armed.get(machine.def.machineId)?.shift() : undefined;
  }

  private async attempt(unitId: string): Promise<void> {
    const e = this.expects.get(unitId);
    if (!e || e.stalled) return;
    const { receiver, job } = e;
    const rid = receiver.def.machineId;
    if (receiver.cell.station || this.inbound.has(rid) || !receiver.canProduce()) return;
    if (!e.announced) {
      e.announced = true;
      await receiver.cell.announceReady(job);
    }
    const h = this.holds.get(unitId);
    if (!h) return;
    if (!h.sender) {
      if (!this.settings.autoArriveAtEntry) return;
      this.expects.delete(unitId);
      this.holds.delete(unitId);
      this.inbound.add(rid);
      this.later(receiver.ms(this.settings.arrivalDelaySec), () => void this.land(receiver, job, h, h.carrierId, null));
      return;
    }
    const sender = h.sender;
    if (this.blocked.has(sender.def.machineId)) return;
    const fault = this.takeFault(sender) ?? this.takeFault(receiver);
    if (fault === TRANSFER_FAULT.STALL) {
      e.stalled = true;
      return;
    }
    if (fault === TRANSFER_FAULT.JAM) {
      this.blocked.add(sender.def.machineId);
      await sender.cell.publishJob(JOB_EVENT.TRANSFER_FAILED, h.job, { peer: rid, failure: TRANSFER_FAILURE.JAM });
      await sender.alarms.raise('TRANSFER-JAM', LEVEL.CRITICAL, `${unitId} jammed leaving ${sender.def.machineId}`, {
        zone: `${sender.def.machineId}-outfeed`, autoClears: false, action: 'Clear the outfeed, then clear the alarm', jobId: h.job.jobId,
      });
      return;
    }
    this.expects.delete(unitId);
    this.holds.delete(unitId);
    this.inbound.add(rid);
    await sender.cell.release(h.job, rid);
    const from = sender.def.machineId;
    if (fault === TRANSFER_FAULT.INCOMPLETE) {
      this.later(receiver.ms(this.settings.handshakeTimeoutSec), () => void this.incomplete(receiver, job, h));
      return;
    }
    const carrierRead = fault === TRANSFER_FAULT.CARRIER_MISMATCH ? `${h.carrierId ?? 'none'}-misread` : h.carrierId;
    this.later(receiver.ms(this.settings.transferSec), () => void this.land(receiver, job, h, carrierRead, from));
  }

  private async land(receiver: MockMachine, job: Job, h: Holding, carrierRead: string | null, from: string | null): Promise<void> {
    this.inbound.delete(receiver.def.machineId);
    const ok = await receiver.cell.receive(job.unitId, carrierRead, from);
    if (!ok) this.returnToOutfeed(h);
    this.poke();
  }

  private async incomplete(receiver: MockMachine, job: Job, h: Holding): Promise<void> {
    this.inbound.delete(receiver.def.machineId);
    await receiver.cell.publishJob(JOB_EVENT.TRANSFER_FAILED, job, {
      peer: h.sender?.def.machineId ?? null, failure: TRANSFER_FAILURE.INCOMPLETE_HANDSHAKE,
    });
    this.returnToOutfeed(h);
  }

  /** A unit that failed to transfer goes back to the sender's outfeed. */
  private returnToOutfeed(h: Holding): void {
    this.holds.set(h.job.unitId, h);
    this.poke();
  }
}
