/**
 * The machine gateway: the seam between machines and escalation rows. It
 * reads escalation events (a new handoff row means "dispatch"), reads every
 * machine message on the line (a receipt means "resolve"), and performs the
 * verbs a person would, as the machine. Neither side knows about the other.
 */

import { standardRows, type HandoffRowAdapter } from '../rows';
import { DECISION, ROW_TYPE } from '../contracts';
import { CONTROLLER, type Action } from './actions';
import { alarmsClearedMeanwhile, arrivalsOnRows, notesOnRows, restoreAddresses, restoreLineRows } from './reconcile';
import { MemoryAddressBook, type AddressBook } from './address-book';
import { admitSender, holdViolation, type AdmissionContext, type Applied } from './admission';
import type { LineDef } from '../../../lib/machines/line';
import { DISPATCH_ON, MESSAGE_KIND, OP, genericCodec, lineFilter, type Envelope, type Inspection, type LineCodec, type ParsedTopic } from '../../../lib/machines/protocol';
import { DISPOSITION, type Disposition, type EscalationEvent, type EscalationFeed, type InboundMessage, type MachineBus } from '../../../lib/machines/transport';
import { ReplyWaiter } from './reply-waiter';
import type { LineEscalations } from './escalations';
import { Executor } from './executor';
import { GATEWAY_LOG, consoleLog, type GatewayLog } from './log';
import { concernsLine, planEscalationEvent, statusFits } from './plan-escalation';
import { planPacing } from './pacing';
import { planMachineMessage } from './plan-machine';
import { GatewayState } from './state';
import { ReceiptBatcher } from './receipts';

export interface GatewaySettings {
  topicRoot: string;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  offlineDebounceMs: number;
  /** How long a dispatch stays valid at the machine (expiresAt). */
  dispatchTtlMs: number;
  /** A connected machine silent this long gets a quiet row; 0 turns the check off. */
  quietMs: number;
  /** How long confirmed message ids gather before a receipt goes out (codecs with receipts). */
  receiptDelayMs?: number;
  /** Note each job's start, progress steps and pauses on the row that holds it; off unless set. */
  lifecycle?: boolean;
  /** With lifecycle notes, progress is noted each time it crosses this many percent; 0 notes none. */
  progressStep?: number;
}

export interface GatewayDeps {
  bus: MachineBus;
  feed: EscalationFeed;
  lt: LineEscalations;
  line: LineDef;
  settings: GatewaySettings;
  log?: GatewayLog;
  /** Reads a host's rows into handoffs; the standard handoff facets by default. */
  rows?: HandoffRowAdapter;
  /** The machines' wire protocol; the line protocol under `settings.topicRoot` by default. */
  codec?: LineCodec;
  /** Where a line that learns addresses keeps them; in memory by default. */
  addresses?: AddressBook;
}

export class MachineGateway {
  readonly state = new GatewayState();
  private readonly rows: HandoffRowAdapter;
  private readonly codec: LineCodec;
  private readonly executor: Executor;
  private readonly receipts: ReceiptBatcher;
  private readonly log: GatewayLog;
  private readonly addresses: AddressBook;
  private readonly admission: AdmissionContext;
  private quietTimer?: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    this.log = deps.log ?? consoleLog;
    this.rows = deps.rows ?? standardRows;
    this.codec = deps.codec ?? genericCodec({ root: deps.settings.topicRoot, line: deps.line });
    this.state.unitsPerDispatch = this.codec.unitsPerDispatch;
    this.state.dispatchOnArrival = this.codec.dispatchOn === DISPATCH_ON.ARRIVAL;
    this.state.lifecycle = deps.settings.lifecycle === true;
    this.state.retainedAlarms = this.codec.retainedAlarms === true;
    this.state.progressStep = deps.settings.progressStep ?? this.state.progressStep;
    this.addresses = deps.addresses ?? new MemoryAddressBook();
    this.executor = new Executor({
      addresses: this.addresses,
      bus: deps.bus, lt: deps.lt, replies: new ReplyWaiter(), state: this.state, line: deps.line,
      codec: this.codec, replyTimeoutMs: deps.settings.replyTimeoutMs,
      dispatchAttempts: deps.settings.dispatchAttempts, offlineDebounceMs: deps.settings.offlineDebounceMs, log: this.log,
    });
    this.admission = { state: this.state, line: deps.line, executor: this.executor, log: this.log, pace: () => this.pace() };
    this.receipts = new ReceiptBatcher({ bus: deps.bus, codec: this.codec, delayMs: deps.settings.receiptDelayMs ?? DEFAULT_RECEIPT_DELAY_MS, log: this.log });
  }

  async start(): Promise<void> {
    await this.deps.bus.connect();
    await this.deps.feed.connect();
    await this.reconcile();
    await this.deps.feed.consume((event) => this.onEscalation(event));
    await this.deps.bus.consume((msg) => this.onMachine(msg));
    if (this.codec.snapshotOnStart) await this.askEveryMachine();
    const { quietMs } = this.deps.settings;
    if (quietMs > 0) {
      const machines = this.deps.line.machines.map((m) => m.machineId);
      this.quietTimer = setInterval(() => this.executor.checkQuiet(machines, quietMs), Math.max(10, Math.floor(quietMs / 4)));
    }
    this.log.info(GATEWAY_LOG.STARTED, { site: this.deps.line.siteId, line: this.deps.line.lineId });
  }

  async stop(): Promise<void> {
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.executor.stop();
    await this.receipts.flush();
    await this.deps.feed.close();
    await this.deps.bus.close();
  }

  /** Machines that report only changes are asked for their full state once the gateway listens. */
  private async askEveryMachine(): Promise<void> {
    const at = Date.now();
    await this.executor.apply(this.deps.line.machines.map((m): Action => ({
      kind: 'command', machineId: m.machineId, op: OP.SNAPSHOT, cmdId: `${m.machineId}:takeover:${at}`, args: {},
    })));
  }

  /** Resolves when no dispatch is in flight (tests). */
  idle(): Promise<void> {
    return this.executor.idle();
  }

  /**
   * On taking the line: open handoff and command rows (a dispatch or command
   * interrupted by a restart is sent again with the same cmdId), the gateway's
   * own alarm, offline and quiet rows, then the machines' retained state to
   * catch what changed while no gateway was listening.
   */
  private async reconcile(): Promise<void> {
    // Handoffs wait until the whole line is read back, so pacing sees every job before it sends one.
    this.state.holdDispatch = true;
    try {
      const addresses = await restoreAddresses(this.state, this.addresses, this.deps.line);
      const handoffs = await this.reconcileHandoffs();
      await this.executor.apply(await arrivalsOnRows(this.state, this.deps.lt, this.deps.settings.dispatchTtlMs));
      await notesOnRows(this.state, this.deps.lt);
      const commands = await this.reconcileCommands();
      const restored = await restoreLineRows(this.state, this.deps.lt, this.deps.line);
      await this.resync();
      this.log.info(GATEWAY_LOG.RECONCILED, { handoffs, commands, addresses, ...restored });
    } finally {
      this.state.holdDispatch = false;
    }
    await this.pace();
  }

  /** Send waiting handoffs to machines that have room (pacing.ts). */
  private async pace(): Promise<void> {
    await this.executor.apply(planPacing(this.state, this.deps.line, this.deps.settings.dispatchTtlMs));
  }

  private async reconcileCommands(): Promise<number> {
    let commands = 0;
    for (const data of await this.deps.lt.listOpen({ type: ROW_TYPE.MACHINE_COMMAND })) {
      const event: EscalationEvent = { type: 'reconcile', escalationId: data.id, role: data.role, verb: 'created', data };
      const actions = planEscalationEvent(this.state, this.deps.line, event, this.deps.settings.dispatchTtlMs, this.rows);
      if (actions.length) commands++;
      await this.executor.apply(actions);
    }
    return commands;
  }

  private async reconcileHandoffs(): Promise<number> {
    let handoffs = 0;
    for (const query of this.rows.openRows(this.deps.line)) {
      for (const data of await this.deps.lt.listOpen(query)) {
        const event: EscalationEvent = { type: 'reconcile', escalationId: data.id, role: data.role, verb: 'created', data };
        const actions = planEscalationEvent(this.state, this.deps.line, event, this.deps.settings.dispatchTtlMs, this.rows);
        if (this.state.get(data.id)) handoffs++;
        await this.executor.apply(actions);
      }
    }
    return handoffs;
  }

  private async resync(): Promise<void> {
    const { line } = this.deps;
    const active = new Set<string>();
    this.state.readingRetained = true;
    try {
      for (const msg of await this.deps.bus.retained(lineFilter(this.codec.root, line.siteId, line.lineId))) {
        for (const raw of this.decode(msg.topic, msg.payload, true)) {
          if (!raw.parsed) continue;
          const seen = await admitSender(this.admission, msg.topic, raw);
          if (!('parsed' in seen) || !seen.parsed) continue;
          if (seen.parsed.kind === MESSAGE_KIND.ALARM && seen.body?.body?.active) active.add(this.state.alarmKey(seen.parsed.ident.machineId, seen.parsed.key!));
          await this.applyMachine(msg.topic, seen.parsed, seen.body);
        }
      }
    } finally {
      this.state.readingRetained = false;
    }
    if (!this.state.retainedAlarms) return;
    for (const gone of alarmsClearedMeanwhile(this.state, active)) {
      this.state.alarms.delete(gone.key);
      await this.executor.apply([{ kind: 'resolve', as: CONTROLLER, rowId: gone.rowId, payload: { decision: DECISION.CLEARED, note: `cleared at ${gone.machineId} while the gateway was away` } }]);
    }
  }

  private async onEscalation(event: EscalationEvent): Promise<Disposition> {
    try {
      const verified = await this.verify(event);
      if (verified) await this.executor.apply(planEscalationEvent(this.state, this.deps.line, verified, this.deps.settings.dispatchTtlMs, this.rows));
      await this.pace();
      return DISPOSITION.ACK;
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { event: event.type, error: err.message });
      return DISPOSITION.NAK;
    }
  }

  /**
   * An event only says which row to look at. The row is read back as the
   * controller, so a row on a role the line does not hold, or an event that
   * disagrees with the stored row, does nothing.
   */
  private async verify(event: EscalationEvent): Promise<EscalationEvent | null> {
    if (!concernsLine(this.state, this.deps.line, event, this.rows)) return null;
    const row = await this.deps.lt.get(event.escalationId);
    if (!row || !statusFits(event.verb, row.status)) return null;
    return { ...event, role: row.role, data: row };
  }

  private async onMachine(msg: InboundMessage): Promise<Disposition> {
    const decoded = this.decode(msg.topic, msg.payload, msg.retained);
    const acted: Inspection[] = [];
    let outcome: Disposition = DISPOSITION.TERM;
    let failed = false;
    for (const raw of decoded) {
      if (!raw.parsed) continue;
      const seen = await admitSender(this.admission, msg.topic, raw);
      if (!('parsed' in seen)) {
        failed ||= seen.failed;
        outcome = worse(outcome, seen.disposition);
        continue;
      }
      acted.push(seen);
      if (seen.violations.length && msg.deliveries === 1) {
        this.log.warn(GATEWAY_LOG.CONTRACT_VIOLATION, { topic: msg.topic, violations: seen.violations });
      }
      const applied = seen.violations.length && this.codec.strict
        ? await holdViolation(this.admission, msg, seen)
        : await this.applyMachine(msg.topic, seen.parsed!, seen.body);
      failed ||= applied.failed;
      outcome = worse(outcome, applied.disposition);
    }
    // No row has claimed it after this many tries, so it is not racing its row: stop. A failed verb always retries.
    if (outcome === DISPOSITION.NAK && !failed && msg.deliveries >= MAX_DELIVERIES) {
      this.log.warn(GATEWAY_LOG.UNMATCHED, { topic: msg.topic, deliveries: msg.deliveries });
      outcome = DISPOSITION.TERM;
    }
    if (outcome !== DISPOSITION.NAK) this.confirm(acted);
    return outcome;
  }

  /** A message the codec cannot read is not retried: it is logged and has no effect. */
  private decode(topic: string, payload: string, retained?: boolean): Inspection[] {
    try {
      return this.codec.decode(topic, payload, retained);
    } catch (err: any) {
      this.log.warn(GATEWAY_LOG.UNREADABLE, { topic, error: err.message });
      return [];
    }
  }

  /** Done with the message: confirm each id its codec asked to confirm. */
  private confirm(decoded: Inspection[]): void {
    const seen = new Set<string>();
    for (const { parsed, receiptId } of decoded) {
      if (!parsed || !receiptId || seen.has(receiptId)) continue;
      seen.add(receiptId);
      this.receipts.add(parsed.ident, receiptId);
    }
  }

  private async applyMachine(topic: string, parsed: ParsedTopic, body: Envelope | null): Promise<Applied> {
    let plan: ReturnType<typeof planMachineMessage>;
    try {
      plan = planMachineMessage(this.state, parsed, body, this.deps.settings.dispatchTtlMs);
    } catch (err: any) {
      this.log.warn(GATEWAY_LOG.UNREADABLE, { topic, error: err.message });
      return { disposition: DISPOSITION.TERM, failed: false };
    }
    try {
      await this.executor.apply(plan.actions);
      await this.pace();
      return { disposition: plan.disposition, failed: false };
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { topic, error: err.message });
      return { disposition: DISPOSITION.NAK, failed: true };
    }
  }
}

const MAX_DELIVERIES = 30;
const DEFAULT_RECEIPT_DELAY_MS = 250;

const RANK: Record<Disposition, number> = { [DISPOSITION.TERM]: 0, [DISPOSITION.ACK]: 1, [DISPOSITION.NAK]: 2 };

/** One wire message may decode to several; any that must be retried retries the message. */
function worse(a: Disposition, b: Disposition): Disposition {
  return RANK[b] > RANK[a] ? b : a;
}
