/**
 * Application receipts. A machine that keeps an outbox until the line
 * controller confirms each event gets that confirmation here: once the
 * gateway is done with a message, its id joins a batch for that machine, and
 * the batch goes out through the codec after a short delay or when full. A
 * replayed event is confirmed again, so a machine that missed a receipt stops
 * resending.
 */

import { addressOf, type LineCodec, type MachineIdent } from '../../../lib/machines/protocol';
import type { MachineBus } from '../../../lib/machines/transport';
import { GATEWAY_LOG, type GatewayLog } from './log';

/** Most message ids one receipt carries. */
export const MAX_RECEIPT_IDS = 100;

export interface ReceiptDeps {
  bus: MachineBus;
  codec: Pick<LineCodec, 'receipt'>;
  /** How long ids gather before a receipt goes out. */
  delayMs: number;
  log: GatewayLog;
}

interface Batch {
  ident: MachineIdent;
  ids: Set<string>;
  timer?: NodeJS.Timeout;
}

export class ReceiptBatcher {
  private batches = new Map<string, Batch>();
  private sending = new Set<Promise<void>>();

  constructor(private readonly d: ReceiptDeps) {}

  /** Whether the codec sends receipts at all. */
  get enabled(): boolean {
    return !!this.d.codec.receipt;
  }

  add(ident: MachineIdent, messageId: string): void {
    if (!this.enabled) return;
    const key = addressOf(ident);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { ident, ids: new Set() };
      this.batches.set(key, batch);
    }
    batch.ids.add(messageId);
    if (batch.ids.size >= MAX_RECEIPT_IDS) this.send(key);
    else batch.timer ??= setTimeout(() => this.send(key), this.d.delayMs);
  }

  /** Send every batch now and wait for the sends. */
  async flush(): Promise<void> {
    for (const key of [...this.batches.keys()]) this.send(key);
    await Promise.all([...this.sending]);
  }

  private send(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;
    this.batches.delete(key);
    if (batch.timer) clearTimeout(batch.timer);
    const ids = [...batch.ids];
    const work = this.publish(batch.ident, ids)
      .catch((err) => this.d.log.warn(GATEWAY_LOG.RECEIPT_FAILED, { machine: batch.ident.machineId, ids: ids.length, error: String(err?.message ?? err) }))
      .finally(() => this.sending.delete(work));
    this.sending.add(work);
  }

  private async publish(ident: MachineIdent, ids: string[]): Promise<void> {
    for (const wire of this.d.codec.receipt!(ident, ids)) await this.d.bus.publish(wire.topic, wire.payload);
  }
}
