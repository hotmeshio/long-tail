/**
 * The floor between stations: where each finished unit waits, which station
 * expects it, and the carrier transfer that joins them, one unit at a time. A
 * receiver says READY when it can take the unit; the sender says RELEASED;
 * after the travel time the receiver confirms ARRIVED. Faults armed on either
 * side are spent on the next transfer that involves it.
 */

import { JOB_EVENT, LEVEL, TRANSFER_FAILURE } from '../../../../lib/machines/protocol';
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
  /** The receiver cannot read the unit's id. */
  UNREADABLE: 'unreadable',
  /** Nothing happens and nothing is reported. */
  STALL: 'stall',
} as const;
export type TransferFault = typeof TRANSFER_FAULT[keyof typeof TRANSFER_FAULT];

interface Expectation { receiver: MockMachine; job: Job; announced: boolean; stalled: boolean }
interface Holding { sender: MockMachine | null; job: Job; unitId: string; carrierId: string | null }

export class Floor {
  /** Every station expecting a unit: the next hop may be dispatched before the unit reaches the current one. */
  private expects = new Map<string, Expectation[]>();
  private holds = new Map<string, Holding>();
  private armed = new Map<string, TransferFault[]>();
  private blocked = new Set<string>();
  private inbound = new Set<string>();
  /** Units on their way to a receiver, so a repeated dispatch does not send them twice. */
  private transit = new Map<string, Expectation>();
  private timers = new Set<NodeJS.Timeout>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly settings: MockSettings) {}

  /** A station accepted a dispatch that includes this unit. */
  expect(receiver: MockMachine, job: Job, unitId: string, carrierId: string | null): void {
    const moving = this.transit.get(unitId);
    if (moving?.receiver === receiver && moving.job === job) return;
    const others = (this.expects.get(unitId) ?? []).filter((e) => e.receiver !== receiver);
    this.expects.set(unitId, [...others, { receiver, job, announced: false, stalled: false }]);
    if (!job.from && !this.holds.has(unitId)) this.holds.set(unitId, { sender: null, job, unitId, carrierId });
    this.poke();
  }

  /** The station no longer expects the unit; a unit still waiting at line entry for `job` is no longer coming. */
  unexpect(unitId: string, receiver: MockMachine, job?: Job): void {
    const left = (this.expects.get(unitId) ?? []).filter((e) => e.receiver !== receiver);
    if (left.length) this.expects.set(unitId, left);
    else this.expects.delete(unitId);
    const h = this.holds.get(unitId);
    if (job && h && !h.sender && h.job === job) this.holds.delete(unitId);
  }

  /** A finished unit waits at its station for the next one. */
  hold(sender: MockMachine, job: Job, unitId: string, carrierId: string | null): void {
    this.holds.set(unitId, { sender, job, unitId, carrierId });
    this.poke();
  }

  drop(unitId: string): void {
    this.holds.delete(unitId);
  }

  /** A person takes a unit back off `sender`'s outfeed, where a failed move left it after the sender closed its job. */
  takeBack(unitId: string, sender: MockMachine): boolean {
    const h = this.holds.get(unitId);
    if (h?.sender !== sender) return false;
    this.holds.delete(unitId);
    return true;
  }

  /** Forget every unit a restarted machine was holding. */
  forgetSender(machineId: string): void {
    for (const [unitId, h] of this.holds) if (h.sender?.def.machineId === machineId) this.holds.delete(unitId);
  }

  disarm(machineId: string): void {
    this.armed.delete(machineId);
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
    if (ok) this.unexpect(unitId, receiver);
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

  /** Each expecting station that can take the unit says READY; the one the unit is waiting for gets it. */
  private async attempt(unitId: string): Promise<void> {
    const h = this.holds.get(unitId);
    for (const e of [...(this.expects.get(unitId) ?? [])]) {
      const rid = e.receiver.def.machineId;
      if (e.stalled || !e.receiver.cell.canTake(e.job) || this.inbound.has(rid) || !e.receiver.canProduce()) continue;
      if (!e.announced) {
        e.announced = true;
        await e.receiver.cell.announceReady(e.job, unitId);
      }
      if (h && serves(h, e)) return this.move(unitId, e, h);
    }
  }

  private async move(unitId: string, e: Expectation, h: Holding): Promise<void> {
    const { receiver } = e;
    const rid = receiver.def.machineId;
    if (!h.sender) {
      if (!this.settings.autoArriveAtEntry) return;
      this.depart(unitId, e, rid);
      this.later(receiver.ms(this.settings.arrivalDelaySec), () => void this.land(receiver, h, h.carrierId, null));
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
      const unit = h.job.units.find((u) => u.unitId === unitId)!;
      await sender.cell.publishJob(JOB_EVENT.TRANSFER_FAILED, h.job, unit, { peer: rid, failure: TRANSFER_FAILURE.JAM });
      await sender.alarms.raise('TRANSFER-JAM', LEVEL.CRITICAL, `${unitId} jammed leaving ${sender.def.machineId}`, {
        zone: `${sender.def.machineId}-outfeed`, autoClears: false, action: 'Clear the outfeed, then clear the alarm', jobId: h.job.jobId,
      });
      return;
    }
    this.depart(unitId, e, rid);
    await sender.cell.release(h.job, unitId, rid);
    const from = sender.def.machineId;
    if (fault === TRANSFER_FAULT.INCOMPLETE) {
      this.later(receiver.ms(this.settings.handshakeTimeoutSec), () => void this.incomplete(receiver, h));
      return;
    }
    if (fault === TRANSFER_FAULT.UNREADABLE) {
      this.later(receiver.ms(this.settings.transferSec), () => void this.unreadable(receiver, h, from));
      return;
    }
    const carrierRead = fault === TRANSFER_FAULT.CARRIER_MISMATCH ? `${h.carrierId ?? 'none'}-misread` : h.carrierId;
    this.later(receiver.ms(this.settings.transferSec), () => void this.land(receiver, h, carrierRead, from));
  }

  private depart(unitId: string, e: Expectation, receiverId: string): void {
    this.transit.set(unitId, e);
    this.unexpect(unitId, e.receiver);
    this.holds.delete(unitId);
    this.inbound.add(receiverId);
  }

  private settle(receiver: MockMachine, unitId: string): void {
    this.transit.delete(unitId);
    this.inbound.delete(receiver.def.machineId);
  }

  private async land(receiver: MockMachine, h: Holding, carrierRead: string | null, from: string | null): Promise<void> {
    this.settle(receiver, h.unitId);
    const ok = await receiver.cell.receive(h.unitId, carrierRead, from);
    if (!ok) this.returnToOutfeed(h);
    this.poke();
  }

  private async unreadable(receiver: MockMachine, h: Holding, from: string): Promise<void> {
    this.settle(receiver, h.unitId);
    await receiver.cell.refuseUnreadable(h.unitId, from);
    this.returnToOutfeed(h);
  }

  private async incomplete(receiver: MockMachine, h: Holding): Promise<void> {
    this.settle(receiver, h.unitId);
    const job = receiver.cell.jobForUnit(h.unitId);
    const unit = job?.units.find((u) => u.unitId === h.unitId);
    if (job && unit) {
      await receiver.cell.publishJob(JOB_EVENT.TRANSFER_FAILED, job, unit, {
        peer: h.sender?.def.machineId ?? null, failure: TRANSFER_FAILURE.INCOMPLETE_HANDSHAKE,
      });
    }
    this.returnToOutfeed(h);
  }

  /** A unit that failed to transfer goes back to the sender's outfeed. */
  private returnToOutfeed(h: Holding): void {
    this.holds.set(h.unitId, h);
    this.poke();
  }
}

/** A unit at line entry goes to the job that took it in; a finished unit goes to the station expecting it from its sender. */
function serves(h: Holding, e: Expectation): boolean {
  return h.sender ? e.job.from === h.sender.def.machineId : e.job === h.job;
}
