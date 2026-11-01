/**
 * The machine surface inside Long Tail. For each line this deployment
 * controls, one replica leads (an advisory lock), makes sure the line's bot
 * accounts exist, and runs the gateway: escalation events in, machine
 * messages in, verbs performed in process as each machine. Workflows never
 * see any of it; their rows are resolved the way a form resolves them. The
 * surface also describes its lines for the dashboard: every replica lists
 * them, and the leader of a line projects it.
 */

import type { CallbackEventAdapter } from '../../lib/events/callback';
import { isDeepStrictEqual } from 'node:util';

import { learnsAddress, machineRole, type LineDef } from '../../lib/machines/line';
import { CONTROL_OPS, OP, declaredRowOps, type LineCodec } from '../../lib/machines/protocol';
import type { InboundMessage } from '../../lib/machines/transport';
import type { InspectResult, LineSummary, LineView } from '../../types/machines-view';
import { ESCALATION_FEED, MACHINE_TRANSPORT, loadMachineLineConfig, type MachineLineConfig } from './config';
import { ApiLineEscalations } from './gateway/api-escalations';
import { MachineGateway } from './gateway/gateway';
import { GATEWAY_LOG, composeLogs, consoleLog, eventsLog, type GatewayLog } from './gateway/log';
import { BotAddressBook, ensureLineBots } from './identities';
import { LineLeadership } from './leadership';
import { createEscalationFeed, createMachineBus, defaultCodec } from './select';
import type { HandoffRowAdapter } from './rows';

type Env = Record<string, string | undefined>;

export interface MachineSurfaceOptions {
  lines: LineDef[];
  /** Transport settings (MACHINE_*); defaults to process.env. */
  env?: Env;
  callbacks?: CallbackEventAdapter;
  log?: GatewayLog;
  codec?: LineCodec;
  /** A codec for one line, keyed `<siteId>/<lineId>`; every other line uses `codec`. */
  codecs?: Record<string, LineCodec>;
  rows?: HandoffRowAdapter;
}

/** The codec a line runs on: its own, the surface's, or the generic line protocol. */
export function codecFor(opts: Pick<MachineSurfaceOptions, 'codec' | 'codecs'>, config: MachineLineConfig, line: LineDef): LineCodec {
  return opts.codecs?.[keyOf(line.siteId, line.lineId)] ?? opts.codec ?? defaultCodec(config, line);
}

/** A message to dry-run against a line. */
export type WireProbe = Pick<InboundMessage, 'topic' | 'payload' | 'retained'>;

/** What settings and the API read of the surface. */
export interface LineSurface {
  /** Every declared line, on every replica. */
  describeLines(): LineSummary[];
  /** The line as its leader sees it; null when this replica is not leading it, or the line is not declared. */
  describeLine(siteId: string, lineId: string): LineView | null;
  /** A dry run of one message; null when this replica is not leading the line. */
  inspect(siteId: string, lineId: string, probe: WireProbe): InspectResult | null;
  /** The declared line, or undefined. */
  findLine(siteId: string, lineId: string): LineDef | undefined;
  /** The ops a machine-command row on this line may ask for. */
  commandOps(siteId: string, lineId: string): string[];
  /** Run a line on this replica: started, replaced when its definition changed, or unchanged. */
  declare(line: LineDef): Promise<DeclareOutcome>;
  /** Stop running a line on this replica; false when it was not running. */
  retire(siteId: string, lineId: string): Promise<boolean>;
}

export type DeclareOutcome = 'started' | 'replaced' | 'unchanged';

/** Inside Long Tail the gateway reads escalation events in process. */
export function surfaceConfig(env: Env): MachineLineConfig {
  const transport = env.MACHINE_TRANSPORT;
  if (transport !== MACHINE_TRANSPORT.NATS && transport !== MACHINE_TRANSPORT.MQTT) {
    throw new Error(`start({ machines }) needs MACHINE_TRANSPORT=nats or mqtt (got "${transport ?? ''}")`);
  }
  return loadMachineLineConfig({ ...env, MACHINE_ESCALATION_FEED: env.MACHINE_ESCALATION_FEED ?? ESCALATION_FEED.IN_PROCESS });
}

/** The line as every replica can describe it: its machines, roles, declared addresses and the codec's own ops. */
export function summarizeLine(line: LineDef, codec: Pick<LineCodec, 'rowOps'>): LineSummary {
  const rowOps = declaredRowOps(codec);
  return {
    siteId: line.siteId, lineId: line.lineId,
    machines: line.machines.map((m) => {
      const learned = learnsAddress(line, m.machineId);
      return {
        machineId: m.machineId, process: m.process, role: machineRole(m),
        address: learned ? null : m.address ?? m.machineId, addressing: learned ? 'learned' : 'declared',
        ...(rowOps.length ? { rowOps } : {}),
      };
    }),
  };
}

/** The ops a machine-command row may ask for: the control ops, a snapshot, and the codec's own. */
export function commandOpsOf(codec: Pick<LineCodec, 'rowOps'>): string[] {
  return [...new Set<string>([...CONTROL_OPS, OP.SNAPSHOT, ...declaredRowOps(codec)])];
}

class LineRun {
  private gateway?: MachineGateway;
  private leading?: Promise<void>;
  private ready = false;
  private stopped = false;
  private readonly leadership: LineLeadership;
  readonly codec: LineCodec;

  constructor(readonly line: LineDef, private readonly config: MachineLineConfig, private readonly opts: MachineSurfaceOptions, private readonly log: GatewayLog) {
    this.leadership = new LineLeadership(`lt-machine-line:${line.siteId}/${line.lineId}`);
    this.codec = codecFor(opts, config, line);
  }

  start(): void {
    const where = { site: this.line.siteId, line: this.line.lineId };
    this.log.info(GATEWAY_LOG.STANDBY, where);
    this.leadership.run(() => (this.leading = this.lead()), async (err) => {
      this.log.warn(GATEWAY_LOG.LEADERSHIP_LOST, { ...where, error: err.message });
      this.ready = false;
      await this.gateway?.stop();
      this.gateway = undefined;
    }).catch((err) => this.log.error(GATEWAY_LOG.START_FAILED, { ...where, error: err.message }));
  }

  /** A gateway still starting finishes first, so none is left running after stop. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    await this.leading?.catch(() => undefined);
    await this.gateway?.stop();
    await this.leadership.stop();
  }

  /** The gateway, once it leads the line. */
  leader(): MachineGateway | undefined {
    return this.ready ? this.gateway : undefined;
  }

  private async lead(): Promise<void> {
    // 1. Identities, 2. gateway on the line's bus and feed, 3. reconcile and consume (gateway.start)
    const ids = await ensureLineBots(this.line);
    if (this.stopped) return;
    const userFor = (as: string) => {
      const id = ids.get(as);
      if (!id) throw new Error(`no bot for "${as}" on ${this.line.siteId}/${this.line.lineId}`);
      return id;
    };
    const { config, line, codec } = this;
    this.gateway = new MachineGateway({
      bus: createMachineBus(config, line, codec),
      codec,
      rows: this.opts.rows,
      feed: createEscalationFeed(config, line, this.opts.callbacks),
      lt: new ApiLineEscalations(userFor),
      addresses: new BotAddressBook(ids),
      line,
      log: this.log,
      settings: {
        topicRoot: config.topicRoot, replyTimeoutMs: config.replyTimeoutMs, dispatchAttempts: config.dispatchAttempts,
        offlineDebounceMs: config.offlineDebounceMs, dispatchTtlMs: config.dispatchTtlMs, quietMs: config.quietMs,
        receiptDelayMs: config.receiptDelayMs, lifecycle: config.lifecycle, progressStep: config.progressStep, wireTelemetry: config.wireTelemetry,
      },
    });
    await this.gateway.start();
    this.ready = true;
    this.log.info(GATEWAY_LOG.LEADING, { site: line.siteId, line: line.lineId });
  }
}

export class MachineSurface implements LineSurface {
  private readonly runs = new Map<string, LineRun>();

  private constructor(private readonly config: MachineLineConfig, private readonly opts: MachineSurfaceOptions, private readonly log: GatewayLog) {}

  /** Validate the configuration, then contend for every line in the background. The registry may add lines later. */
  static start(opts: MachineSurfaceOptions): MachineSurface {
    const config = surfaceConfig(opts.env ?? process.env);
    const surface = new MachineSurface(config, opts, opts.log ?? consoleLog);
    for (const line of opts.lines) surface.begin(line);
    return surface;
  }

  async stop(): Promise<void> {
    for (const run of this.runs.values()) await run.stop();
    this.runs.clear();
  }

  async declare(line: LineDef): Promise<DeclareOutcome> {
    const current = this.run(line.siteId, line.lineId);
    if (current && isDeepStrictEqual(current.line, line)) return 'unchanged';
    if (current) await current.stop();
    this.begin(line);
    return current ? 'replaced' : 'started';
  }

  async retire(siteId: string, lineId: string): Promise<boolean> {
    const current = this.run(siteId, lineId);
    if (!current) return false;
    this.runs.delete(keyOf(siteId, lineId));
    await current.stop();
    return true;
  }

  describeLines(): LineSummary[] {
    return [...this.runs.values()].map((run) => summarizeLine(run.line, run.codec));
  }

  describeLine(siteId: string, lineId: string): LineView | null {
    const gateway = this.run(siteId, lineId)?.leader();
    return gateway ? gateway.state.project(this.findLine(siteId, lineId)!) : null;
  }

  inspect(siteId: string, lineId: string, probe: WireProbe): InspectResult | null {
    return this.run(siteId, lineId)?.leader()?.inspect(probe) ?? null;
  }

  findLine(siteId: string, lineId: string): LineDef | undefined {
    return this.run(siteId, lineId)?.line;
  }

  commandOps(siteId: string, lineId: string): string[] {
    const run = this.run(siteId, lineId);
    return run ? commandOpsOf(run.codec) : [];
  }

  private begin(line: LineDef): void {
    const run = new LineRun(line, this.config, this.opts, composeLogs(this.log, eventsLog(line)));
    this.runs.set(keyOf(line.siteId, line.lineId), run);
    run.start();
  }

  private run(siteId: string, lineId: string): LineRun | undefined {
    return this.runs.get(keyOf(siteId, lineId));
  }
}

function keyOf(siteId: string, lineId: string): string {
  return `${siteId}/${lineId}`;
}
