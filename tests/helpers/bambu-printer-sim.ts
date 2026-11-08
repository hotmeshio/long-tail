/**
 * The example's simulated Bambu printer as the site broker sees it through its
 * bridge: requests arrive on `.../<serial>/request`, reports leave on
 * `.../<serial>/report`, and the bridge state is retained on `.../<serial>/bridge`.
 */

import { MemoryBroker } from '../../lib/machines/transport';
import { SimPrinter as Printer, type SimPrinterOptions as PrinterOptions } from '../../examples/workflows/bambu-printer/sim/printer';

export interface SimPrinterOptions extends PrinterOptions {
  prefix: string;
}

export class SimPrinter extends Printer {
  private readonly clientId = `sim-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly broker: MemoryBroker, private readonly at: SimPrinterOptions) {
    super({ report: (body) => broker.publish(`${at.prefix}/report`, JSON.stringify(body)) }, at);
  }

  connect(): void {
    this.broker.connect(this.clientId);
    this.broker.subscribe(this.clientId, `${this.at.prefix}/request`, (msg) => this.receive(JSON.parse(msg.payload.toString())));
    this.broker.publish(`${this.at.prefix}/bridge`, '1', true);
  }
}
