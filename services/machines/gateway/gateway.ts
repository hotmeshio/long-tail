/**
 * The machine gateway: the seam between machines and escalation rows. It
 * reads escalation events (a new handoff row means "dispatch"), reads every
 * machine message on the line (a receipt means "resolve"), and performs the
 * verbs a person would, as the machine. Neither side knows about the other.
 */

import { standardRows, type HandoffRowAdapter } from '../rows';
import { DECISION } from '../contracts';
import { CONTROLLER } from './actions';
import { alarmsClearedMeanwhile, restoreLineRows } from './reconcile';
import type { LineDef } from '../../../lib/machines/line';
import { MESSAGE_KIND, genericCodec, lineFilter, type Envelope, type LineCodec, type ParsedTopic } from '../../../lib/machines/protocol';
import { DISPOSITION, type Disposition, type EscalationEvent, type EscalationFeed, type InboundMessage, type MachineBus } from '../../../lib/machines/transport';
import { ReplyWaiter } from './reply-waiter';
import type { LineEscalations } from './escalations';
import { Executor } from './executor';
import { GATEWAY_LOG, consoleLog, type GatewayLog } from './log';
import { planEscalationEvent } from './plan-escalation';
import { planMachineMessage } from './plan-machine';
import { GatewayState } from './state';

export interface GatewaySettings {
  topicRoot: string;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  offlineDebounceMs: number;
  /** How long a dispatch stays valid at the machine (expiresAt). */
  dispatchTtlMs: number;
  /** A connected machine silent this long gets a quiet row; 0 turns the check off. */
  quietMs: number;
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
}

export class MachineGateway {
  readonly state = new GatewayState();
  private readonly rows: HandoffRowAdapter;
  private readonly codec: LineCodec;
  private readonly executor: Executor;
  private readonly log: GatewayLog;
  private quietTimer?: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    this.log = deps.log ?? consoleLog;
    this.rows = deps.rows ?? standardRows;
    this.codec = deps.codec ?? genericCodec({ root: deps.settings.topicRoot });
    this.state.unitsPerDispatch = this.codec.unitsPerDispatch;
    this.executor = new Executor({
      bus: deps.bus, lt: deps.lt, replies: new ReplyWaiter(), state: this.state, line: deps.line,
      codec: this.codec, replyTimeoutMs: deps.settings.replyTimeoutMs,
      dispatchAttempts: deps.settings.dispatchAttempts, offlineDebounceMs: deps.settings.offlineDebounceMs, log: this.log,
    });
  }

  async start(): Promise<void> {
    await this.deps.bus.connect();
    await this.deps.feed.connect();
    await this.reconcile();
    await this.deps.feed.consume((event) => this.onEscalation(event));
    await this.deps.bus.consume((msg) => this.onMachine(msg));
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
    await this.deps.feed.close();
    await this.deps.bus.close();
  }

  /** Resolves when no dispatch is in flight (tests). */
  idle(): Promise<void> {
    return this.executor.idle();
  }

  /**
   * On taking the line: open handoff rows (a dispatch interrupted by a restart
   * is sent again with the same cmdId), the gateway's own alarm, offline and
   * quiet rows, then the machines' retained state to catch what changed while
   * no gateway was listening.
   */
  private async reconcile(): Promise<void> {
    const handoffs = await this.reconcileHandoffs();
    const restored = await restoreLineRows(this.state, this.deps.lt, this.deps.line);
    await this.resync();
    this.log.info(GATEWAY_LOG.RECONCILED, { handoffs, ...restored });
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
    for (const msg of await this.deps.bus.retained(lineFilter(this.codec.root, line.siteId, line.lineId))) {
      for (const seen of this.codec.decode(msg.topic, msg.payload, true)) {
        if (!seen.parsed) continue;
        if (seen.parsed.kind === MESSAGE_KIND.ALARM && seen.body?.body?.active) active.add(this.state.alarmKey(seen.parsed.ident.machineId, seen.parsed.key!));
        await this.applyMachine(msg.topic, seen.parsed, seen.body);
      }
    }
    for (const gone of alarmsClearedMeanwhile(this.state, active)) {
      this.state.alarms.delete(gone.key);
      await this.executor.apply([{ kind: 'resolve', as: CONTROLLER, rowId: gone.rowId, payload: { decision: DECISION.CLEARED, note: `cleared at ${gone.machineId} while the gateway was away` } }]);
    }
  }

  private async onEscalation(event: EscalationEvent): Promise<Disposition> {
    try {
      await this.executor.apply(planEscalationEvent(this.state, this.deps.line, event, this.deps.settings.dispatchTtlMs, this.rows));
      return DISPOSITION.ACK;
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { event: event.type, error: err.message });
      return DISPOSITION.NAK;
    }
  }

  private async onMachine(msg: InboundMessage): Promise<Disposition> {
    const decoded = this.codec.decode(msg.topic, msg.payload, msg.retained);
    let outcome: Disposition = DISPOSITION.TERM;
    for (const seen of decoded) {
      if (!seen.parsed) continue;
      if (seen.violations.length && msg.deliveries === 1) {
        this.log.warn(GATEWAY_LOG.CONTRACT_VIOLATION, { topic: msg.topic, violations: seen.violations });
      }
      outcome = worse(outcome, await this.applyMachine(msg.topic, seen.parsed, seen.body));
    }
    return outcome;
  }

  private async applyMachine(topic: string, parsed: ParsedTopic, body: Envelope | null): Promise<Disposition> {
    const plan = planMachineMessage(this.state, parsed, body, this.deps.settings.dispatchTtlMs);
    try {
      await this.executor.apply(plan.actions);
      return plan.disposition;
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { topic, error: err.message });
      return DISPOSITION.NAK;
    }
  }
}

const RANK: Record<Disposition, number> = { [DISPOSITION.TERM]: 0, [DISPOSITION.ACK]: 1, [DISPOSITION.NAK]: 2 };

/** One wire message may decode to several; any that must be retried retries the message. */
function worse(a: Disposition, b: Disposition): Disposition {
  return RANK[b] > RANK[a] ? b : a;
}
