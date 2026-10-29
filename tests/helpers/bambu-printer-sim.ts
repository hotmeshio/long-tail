/**
 * A Bambu printer as the site broker sees it through its bridge: requests
 * arrive on `.../<serial>/request`, reports leave on `.../<serial>/report`
 * (a full one for `pushall`, then only what changed), and the bridge state is
 * retained on `.../<serial>/bridge`. A print runs in `steps` ticks; tests can
 * hold it at a percent, run it out of filament, and resume it.
 */

import { MemoryBroker } from '../../lib/machines/transport';
import { fullReport } from '../fixtures/bambu/reports';

const RUNOUT = 134184977;
const BUSY_CODE = 84033544;

export interface SimPrinterOptions {
  prefix: string;
  /** Ticks from start to finish. */
  steps?: number;
  tickMs?: number;
}

export class SimPrinter {
  readonly requests: Record<string, any>[] = [];
  private report: Record<string, any> = { gcode_state: 'IDLE', stg_cur: 255, mc_percent: 0, mc_remaining_time: 0, layer_num: 0, total_layer_num: 8, subtask_name: '', print_error: 0 };
  private timer?: NodeJS.Timeout;
  private holdAt?: number;
  private seq = 1_000;
  private readonly clientId = `sim-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly broker: MemoryBroker, private readonly opts: SimPrinterOptions) {}

  connect(): void {
    this.broker.connect(this.clientId);
    this.broker.subscribe(this.clientId, `${this.opts.prefix}/request`, (msg) => this.onRequest(JSON.parse(msg.payload.toString())));
    this.broker.publish(`${this.opts.prefix}/bridge`, '1', true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Progress stops once it reaches `percent`, until `release()`. */
  hold(percent: number): void {
    this.holdAt = percent;
  }

  release(): void {
    this.holdAt = undefined;
  }

  get state(): Record<string, any> {
    return { ...this.report };
  }

  /** A print started elsewhere takes the printer; it refuses a new one until `vacate()`. */
  occupy(): void {
    this.change({ gcode_state: 'RUNNING', stg_cur: 0, subtask_name: 'a-print-started-elsewhere' });
  }

  vacate(): void {
    this.change({ gcode_state: 'IDLE', stg_cur: 255, subtask_name: '' });
  }

  /** The external spool runs out: the print pauses with the runout error. */
  runOut(): void {
    this.change({ gcode_state: 'PAUSE', print_error: RUNOUT });
  }

  /** Someone at the printer loads filament and resumes. */
  resumeAtPrinter(): void {
    this.change({ gcode_state: 'RUNNING', print_error: 0 });
  }

  private send(body: Record<string, unknown>): void {
    this.broker.publish(`${this.opts.prefix}/report`, JSON.stringify(body));
  }

  private change(fields: Record<string, unknown>): void {
    Object.assign(this.report, fields);
    this.send({ print: { ...fields, command: 'push_status', msg: 1, sequence_id: String(this.seq++) } });
  }

  private ack(command: string, sequenceId: string, ok = true): void {
    const result = ok ? { reason: 'success', result: 'success' } : { err_code: BUSY_CODE };
    this.send({ print: { sequence_id: sequenceId, command, param: '', ...result } });
  }

  private onRequest(req: Record<string, any>): void {
    this.requests.push(req);
    if (req.pushing?.command === 'pushall') {
      this.send(fullReport({ ...this.report, sequence_id: String(this.seq++) }));
      return;
    }
    const p = req.print;
    if (!p) return;
    if (p.command === 'project_file') return this.startPrint(p);
    if (p.command === 'pause') {
      this.ack('pause', p.sequence_id);
      return this.change({ gcode_state: 'PAUSE' });
    }
    if (p.command === 'resume') {
      this.ack('resume', p.sequence_id);
      return this.change({ gcode_state: 'RUNNING', print_error: 0 });
    }
    if (p.command === 'stop') {
      this.ack('stop', p.sequence_id);
      this.stop();
      return this.change({ gcode_state: 'FAILED' });
    }
  }

  private startPrint(p: Record<string, any>): void {
    const busy = ['PREPARE', 'RUNNING', 'PAUSE'].includes(this.report.gcode_state);
    this.ack('project_file', p.sequence_id, !busy);
    if (busy) return;
    const steps = this.opts.steps ?? 8;
    // As a real printer does: the new job is named first, while the state still shows the last job's end.
    this.change({ subtask_name: p.subtask_name });
    this.change({ gcode_state: 'RUNNING', stg_cur: 2, mc_percent: 0, layer_num: 0, total_layer_num: steps, print_error: 0 });
    let tick = 0;
    this.timer = setInterval(() => {
      if (this.report.gcode_state !== 'RUNNING') return;
      const next = Math.min(100, Math.round(((tick + 1) / steps) * 100));
      if (this.holdAt !== undefined && next > this.holdAt) return;
      tick += 1;
      if (next >= 100) {
        this.stop();
        this.change({ gcode_state: 'FINISH', stg_cur: 255, mc_percent: 100, mc_remaining_time: 0, layer_num: steps });
        return;
      }
      this.change({ stg_cur: 0, mc_percent: next, mc_remaining_time: steps - tick, layer_num: tick });
    }, this.opts.tickMs ?? 40);
  }
}
