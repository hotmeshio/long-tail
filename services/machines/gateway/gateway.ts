/**
 * The machine gateway: the seam between machines and escalation rows. It
 * reads escalation events (a new handoff row means "dispatch"), reads every
 * machine message on the line (a receipt means "resolve"), and performs the
 * verbs a person would, as the machine. Neither side knows about the other.
 */

import { ROW_TYPE } from '../contracts';
import type { LineDef } from '../../../lib/machines/line';
import { inspectMessage } from '../../../lib/machines/protocol';
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
}

export class MachineGateway {
  readonly state = new GatewayState();
  private readonly executor: Executor;
  private readonly log: GatewayLog;
  private quietTimer?: NodeJS.Timeout;

  constructor(private readonly deps: GatewayDeps) {
    this.log = deps.log ?? consoleLog;
    this.executor = new Executor({
      bus: deps.bus, lt: deps.lt, replies: new ReplyWaiter(), state: this.state, line: deps.line,
      topicRoot: deps.settings.topicRoot, replyTimeoutMs: deps.settings.replyTimeoutMs,
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

  /** Open handoff rows at boot, so a dispatch interrupted by a restart is sent again (same cmdId). */
  private async reconcile(): Promise<void> {
    const rows = await this.deps.lt.listOpen(ROW_TYPE.HANDOFF);
    for (const data of rows) {
      const event: EscalationEvent = { type: 'reconcile', escalationId: data.id, role: data.role, verb: 'created', data };
      await this.executor.apply(planEscalationEvent(this.state, this.deps.line, event, this.deps.settings.dispatchTtlMs));
    }
    this.log.info(GATEWAY_LOG.RECONCILED, { handoffs: rows.length });
  }

  private async onEscalation(event: EscalationEvent): Promise<Disposition> {
    try {
      await this.executor.apply(planEscalationEvent(this.state, this.deps.line, event, this.deps.settings.dispatchTtlMs));
      return DISPOSITION.ACK;
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { event: event.type, error: err.message });
      return DISPOSITION.NAK;
    }
  }

  private async onMachine(msg: InboundMessage): Promise<Disposition> {
    const { topicRoot } = this.deps.settings;
    const seen = inspectMessage(topicRoot, msg.topic, msg.payload, msg.retained);
    if (!seen.parsed) return DISPOSITION.TERM;
    if (seen.violations.length && msg.deliveries === 1) {
      this.log.warn(GATEWAY_LOG.CONTRACT_VIOLATION, { topic: msg.topic, violations: seen.violations });
    }
    const plan = planMachineMessage(this.state, seen.parsed, seen.body, this.deps.settings.dispatchTtlMs);
    try {
      await this.executor.apply(plan.actions);
      return plan.disposition;
    } catch (err: any) {
      this.log.error(GATEWAY_LOG.VERB_FAILED, { topic: msg.topic, error: err.message });
      return DISPOSITION.NAK;
    }
  }
}
