/**
 * The machine surface inside Long Tail. For each line this deployment
 * controls, one replica leads (an advisory lock), makes sure the line's bot
 * accounts exist, and runs the gateway: escalation events in, machine
 * messages in, verbs performed in process as each machine. Workflows never
 * see any of it; their rows are resolved the way a form resolves them.
 */

import type { CallbackEventAdapter } from '../../lib/events/callback';
import type { LineDef } from '../../lib/machines/line';
import { ESCALATION_FEED, MACHINE_TRANSPORT, loadMachineLineConfig, type MachineLineConfig } from './config';
import { ApiLineEscalations } from './gateway/api-escalations';
import { MachineGateway } from './gateway/gateway';
import { GATEWAY_LOG, consoleLog, type GatewayLog } from './gateway/log';
import { ensureLineBots } from './identities';
import { LineLeadership } from './leadership';
import { createEscalationFeed, createMachineBus, defaultCodec } from './select';
import type { LineCodec } from '../../lib/machines/protocol';
import type { HandoffRowAdapter } from './rows';

type Env = Record<string, string | undefined>;

export interface MachineSurfaceOptions {
  lines: LineDef[];
  /** Transport settings (MACHINE_*); defaults to process.env. */
  env?: Env;
  callbacks?: CallbackEventAdapter;
  log?: GatewayLog;
  codec?: LineCodec;
  rows?: HandoffRowAdapter;
}

/** Inside Long Tail an MQTT-only deployment reads escalation events in process. */
export function surfaceConfig(env: Env): MachineLineConfig {
  const transport = env.MACHINE_TRANSPORT;
  if (transport !== MACHINE_TRANSPORT.NATS && transport !== MACHINE_TRANSPORT.MQTT) {
    throw new Error(`start({ machines }) needs MACHINE_TRANSPORT=nats or mqtt (got "${transport ?? ''}")`);
  }
  const feed = env.MACHINE_ESCALATION_FEED ?? (transport === MACHINE_TRANSPORT.NATS ? ESCALATION_FEED.JETSTREAM : ESCALATION_FEED.IN_PROCESS);
  return loadMachineLineConfig({ ...env, MACHINE_ESCALATION_FEED: feed });
}

class LineRun {
  private gateway?: MachineGateway;
  private readonly leadership: LineLeadership;

  constructor(private readonly line: LineDef, private readonly config: MachineLineConfig, private readonly opts: MachineSurfaceOptions, private readonly log: GatewayLog) {
    this.leadership = new LineLeadership(`lt-machine-line:${line.siteId}/${line.lineId}`);
  }

  start(): void {
    const where = { site: this.line.siteId, line: this.line.lineId };
    this.log.info(GATEWAY_LOG.STANDBY, where);
    this.leadership.run(() => this.lead(), async (err) => {
      this.log.warn(GATEWAY_LOG.LEADERSHIP_LOST, { ...where, error: err.message });
      await this.gateway?.stop();
      this.gateway = undefined;
    }).catch((err) => this.log.error(GATEWAY_LOG.START_FAILED, { ...where, error: err.message }));
  }

  async stop(): Promise<void> {
    await this.gateway?.stop();
    await this.leadership.stop();
  }

  private async lead(): Promise<void> {
    // 1. Identities, 2. gateway on the line's bus and feed, 3. reconcile and consume (gateway.start)
    const ids = await ensureLineBots(this.line);
    const userFor = (as: string) => {
      const id = ids.get(as);
      if (!id) throw new Error(`no bot for "${as}" on ${this.line.siteId}/${this.line.lineId}`);
      return id;
    };
    const { config, line } = this;
    const codec = this.opts.codec ?? defaultCodec(config);
    this.gateway = new MachineGateway({
      bus: createMachineBus(config, line, codec),
      codec,
      rows: this.opts.rows,
      feed: createEscalationFeed(config, line, this.opts.callbacks),
      lt: new ApiLineEscalations(userFor),
      line,
      log: this.log,
      settings: {
        topicRoot: config.topicRoot, replyTimeoutMs: config.replyTimeoutMs, dispatchAttempts: config.dispatchAttempts,
        offlineDebounceMs: config.offlineDebounceMs, dispatchTtlMs: config.dispatchTtlMs, quietMs: config.quietMs,
      },
    });
    await this.gateway.start();
    this.log.info(GATEWAY_LOG.LEADING, { site: line.siteId, line: line.lineId });
  }
}

export class MachineSurface {
  private constructor(private readonly runs: LineRun[]) {}

  /** Validate the configuration, then contend for every line in the background. */
  static start(opts: MachineSurfaceOptions): MachineSurface {
    if (!opts.lines.length) throw new Error('start({ machines }) needs at least one line');
    const config = surfaceConfig(opts.env ?? process.env);
    const log = opts.log ?? consoleLog;
    const runs = opts.lines.map((line) => new LineRun(line, config, opts, log));
    for (const run of runs) run.start();
    return new MachineSurface(runs);
  }

  async stop(): Promise<void> {
    for (const run of this.runs) await run.stop();
  }
}
