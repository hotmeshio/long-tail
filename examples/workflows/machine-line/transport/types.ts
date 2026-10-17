/**
 * Two sides of the machine fabric. A machine holds a MachineLink: one MQTT
 * client with a will, publishing under its own subtree and hearing only its
 * own commands. The gateway holds a MachineBus: durable, ordered delivery of
 * every machine message on the line, QoS 1 command egress, and retained reads.
 */

export const DISPOSITION = {
  /** Handled; do not deliver again. */
  ACK: 'ack',
  /** Not yet actionable (its row does not exist yet); deliver again later. */
  NAK: 'nak',
  /** Never actionable; drop it. */
  TERM: 'term',
} as const;
export type Disposition = typeof DISPOSITION[keyof typeof DISPOSITION];

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
  consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void>;
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
  consume(handler: (event: EscalationEvent) => Promise<Disposition>): Promise<void>;
  close(): Promise<void>;
}

/** MQTT filter match with `+` (one level) and `#` (the rest). */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

const ESCALATION_SUBJECT = /^(?:.*\.)?system\.escalation\.([^.]+)\.([^.]+)\.([^.]+)$/;

/** Read an LTEvent body into an EscalationEvent; null for other families. */
export function toEscalationEvent(body: Record<string, any>): EscalationEvent | null {
  const match = typeof body?.type === 'string' ? ESCALATION_SUBJECT.exec(body.type) : null;
  if (!match) return null;
  const [, role, escalationId, verb] = match;
  return { type: body.type, escalationId: body.escalationId ?? escalationId, role: body.role ?? role, verb, data: body.data ?? {} };
}
