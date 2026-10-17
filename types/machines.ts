/**
 * The machine surface: a line of machines, the messages they exchange with
 * Long Tail, and the transports that carry them. Runtime values live in
 * lib/machines and services/machines.
 */

/** What a consumer tells the transport about one delivered message. */
export type MachineDisposition = 'ack' | 'nak' | 'term';

/** A machine's place on the site. Each machine is one MQTT client. */
export interface MachineIdent {
  siteId: string;
  lineId: string;
  machineId: string;
}

/** Every message: version, a unique id (the dedupe key), the event time, the source, the body. */
export interface Envelope<T = Record<string, any>> {
  v: string;
  id: string;
  at: string;
  source: { site: string; line: string; machine: string };
  body: T;
}

export interface MaterialDef {
  material: string;
  lot: string;
}

export interface MeasurementDef {
  name: string;
  target: number;
  unit?: string;
  min?: number;
  max?: number;
  /** Spread of simulated readings around the target. */
  noise?: number;
}

export interface MachineDef {
  /** The role whose handoff rows this machine resolves; defaults to line-<process>. */
  role?: string;
  machineId: string;
  process: string;
  description: string;
  carrier: 'bind' | 'release' | 'none';
  cycleSec: number;
  changeoverSec: number;
  progressEverySec?: number;
  /** The reason a rejected unit reports when none is given. */
  rejectReason: string;
  /** recipe id → versions the machine holds. */
  recipes: Record<string, string[]>;
  materials: MaterialDef[];
  measurements: MeasurementDef[];
  /** fault code → description. */
  faults: Record<string, string>;
  /** The software version the machine reports. */
  software?: string;
  /** Versions the line controller will dispatch to; unset allows any. */
  allowedSoftware?: string[];
  /**
   * Most jobs the machine is sent or holds at once, queued or in work. Further
   * handoffs wait in its role queue until it has room. Unset: no limit.
   */
  queueDepth?: number;
}

export interface LineDef {
  /**
   * Role names: the person at line exit and the operator (default line-exit
   * and line-operator), and `receivers`, any other roles of people who take
   * units straight from a machine. Machine bots join the exit and receiver
   * roles so they can record their releases on those rows.
   */
  roles?: { exit?: string; operator?: string; receivers?: string[] };
  siteId: string;
  lineId: string;
  machines: MachineDef[];
}

export interface InboundMessage {
  topic: string;
  payload: string;
  /** The publisher's retain flag, when the transport reports it. */
  retained?: boolean;
  /** 1 on first delivery. */
  deliveries: number;
}

export interface LinkWill {
  topic: string;
  payload: string;
  retain: boolean;
}

export interface PublishOptions {
  qos: 0 | 1;
  retain?: boolean;
}

export interface LinkConnectOptions {
  clientId: string;
  will: LinkWill;
  /** Called when the transport re-establishes the session by itself (a broker restart). */
  onRestored?: () => void;
}

export interface MachineLink {
  readonly connected: boolean;
  connect(opts: LinkConnectOptions): Promise<void>;
  publish(topic: string, payload: string, opts: PublishOptions): Promise<void>;
  subscribe(filter: string, handler: (msg: InboundMessage) => void): Promise<void>;
  /** Graceful drops the will; ungraceful lets the broker publish it. */
  disconnect(graceful: boolean): Promise<void>;
}

export interface MachineBus {
  connect(): Promise<void>;
  consume(handler: (msg: InboundMessage) => Promise<MachineDisposition>): Promise<void>;
  /** Reliable delivery, so a command queues for a machine that is away. */
  publish(topic: string, payload: string, opts?: { retain?: boolean }): Promise<void>;
  retained(filter: string): Promise<InboundMessage[]>;
  close(): Promise<void>;
}

/** An escalation lifecycle event as Long Tail publishes it (lib/events/escalation-wire.ts). */
export interface EscalationEvent {
  /** e.g. system.escalation.line-trim.<id>.created */
  type: string;
  escalationId: string;
  role: string;
  verb: string;
  data: Record<string, any>;
}

export interface EscalationFeed {
  connect(): Promise<void>;
  consume(handler: (event: EscalationEvent) => Promise<MachineDisposition>): Promise<void>;
  close(): Promise<void>;
}

export interface MqttEndpoint {
  url: string;
  /** 5 = MQTT 5 (the machine broker), 4 = MQTT 3.1.1. */
  protocolVersion: 4 | 5;
  /** File paths may contain {clientId}, so each machine presents its own certificate. */
  caFile?: string;
  certFile?: string;
  keyFile?: string;
  username?: string;
  password?: string;
}
