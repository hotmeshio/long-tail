/**
 * Messaging: the capability Long Tail uses to tell every container what
 * changed (pub/sub) and to keep a durable, replayable record that consumers
 * acknowledge (streams). A provider implements both; NATS with JetStream is
 * the one to deploy, and memory serves tests. Nothing here names a provider.
 *
 * Subjects are dot-separated tokens. In a filter, `*` matches one token and
 * `>` matches one or more trailing tokens.
 */

export type Subject = string;

export interface LTMessage {
  subject: Subject;
  payload: string;
}

export interface LTSubscription {
  close(): Promise<void>;
}

/** Fire-and-forget fan-out to every current subscriber. */
export interface LTPubSub {
  publish(subject: Subject, payload: string): Promise<void>;
  subscribe(filter: Subject, handler: (message: LTMessage) => void): LTSubscription;
}

/** What a consumer does with a stream message: ack (handled), nak (deliver again after a delay), term (drop). */
export type Delivery = 'ack' | 'nak' | 'term';

/** Where a new consumer starts: only messages appended after it, or the whole retained history. */
export type StartAt = 'new' | 'all';

export interface StreamSpec {
  name: string;
  /** Subjects the stream keeps. */
  subjects: Subject[];
  /** How long a message is kept. */
  maxAgeMs: number;
}

export interface ConsumerSpec {
  /** Durable name; a consumer keeps its position across restarts. */
  name: string;
  /** Subjects this consumer reads from the stream. */
  filterSubjects: Subject[];
  /** How long a delivered, unsettled message waits before it is delivered again. */
  ackWaitMs?: number;
  startAt?: StartAt;
}

export interface LTStreamMessage extends LTMessage {
  /** 1 on first delivery. */
  deliveries: number;
}

export interface LTConsumeOptions {
  /** Delay before a nak'd message is delivered again. */
  nakDelayMs?: number;
}

/** Durable streams: messages kept, delivered to named consumers in order, one at a time, until settled. */
export interface LTStreams {
  /** Create the stream, or bring an existing one's subjects and age up to the spec. */
  ensureStream(spec: StreamSpec): Promise<void>;
  /** Create the consumer, or bring an existing one's filter up to the spec; its position is kept. */
  ensureConsumer(stream: string, spec: ConsumerSpec): Promise<void>;
  /** Append a message; resolves once the stream holds it. */
  append(subject: Subject, payload: string): Promise<void>;
  /** Deliver the consumer's messages to `handler` one at a time; a thrown handler counts as a nak. */
  consume(
    stream: string,
    consumer: string,
    handler: (message: LTStreamMessage) => Promise<Delivery>,
    opts?: LTConsumeOptions,
  ): Promise<LTSubscription>;
}

export interface LTMessagingProvider {
  /** The provider's name, for logs. */
  readonly name: string;
  /** Whether the provider holds a live connection now. */
  readonly connected: boolean;
  readonly pubsub: LTPubSub;
  /** Null when the provider has no durable streams (for example NATS without JetStream). */
  readonly streams: LTStreams | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
