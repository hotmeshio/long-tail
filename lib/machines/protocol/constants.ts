/**
 * The line protocol: how a machine on an automated line talks to the line
 * controller over MQTT. Each machine publishes under its own subtree and
 * hears only its own commands. Every message is a small JSON envelope.
 *
 *   {root}/{site}/{line}/{machine}/presence     retained; birth and will, with the software version
 *   {root}/{site}/{line}/{machine}/snapshot     retained; full machine state and its boot id
 *   {root}/{site}/{line}/{machine}/job          job lifecycle and unit handoff
 *   {root}/{site}/{line}/{machine}/alarm/{id}   retained while active
 *   {root}/{site}/{line}/{machine}/telemetry    best effort readings
 *   {root}/{site}/{line}/{machine}/cmd          controller to machine
 *   {root}/{site}/{line}/{machine}/cmd/reply    machine to controller
 */

export const PROTOCOL_VERSION = '1';

export const QOS = { BEST_EFFORT: 0, RELIABLE: 1 } as const;

/** A command with no reply inside this window counts as refused. */
export const REPLY_DEADLINE_MS = 5_000;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const PRESENCE_HEARTBEAT_SEC = 30;
export const SNAPSHOT_HEARTBEAT_SEC = 60;

export const CHANNEL = {
  PRESENCE: 'presence',
  SNAPSHOT: 'snapshot',
  JOB: 'job',
  ALARM: 'alarm',
  TELEMETRY: 'telemetry',
  CMD: 'cmd',
  REPLY: 'cmd/reply',
  /** report/<name>: production, availability, inventory and other reporting, kept in the event stream. */
  REPORT: 'report',
} as const;

export const MODE = {
  IDLE: 'idle',
  RUNNING: 'running',
  CHANGEOVER: 'changeover',
  FAULTED: 'faulted',
  EMERGENCY_STOP: 'emergency-stop',
  MAINTENANCE: 'maintenance',
} as const;
export type Mode = typeof MODE[keyof typeof MODE];
export const PRODUCTIVE_MODES: readonly Mode[] = [MODE.IDLE, MODE.RUNNING];

export const LEVEL = { INFO: 'info', WARNING: 'warning', CRITICAL: 'critical', EMERGENCY: 'emergency' } as const;
export type Level = typeof LEVEL[keyof typeof LEVEL];
/** Levels that stop work and need a person. */
export const STOPPING_LEVELS: readonly Level[] = [LEVEL.CRITICAL, LEVEL.EMERGENCY];

/**
 * Job events, one per unit: a job carries one or more units through a
 * machine together. A unit moves between machines in a handshake: the
 * receiver says READY, the sender says RELEASED, the receiver confirms
 * ARRIVED. ARRIVED is the receipt that ends a handoff. WITHDRAWN means the
 * job left the queue, by a cancel or by the machine giving it up.
 */
export const JOB_EVENT = {
  QUEUED: 'queued',
  READY: 'ready',
  ARRIVED: 'arrived',
  /** The receiver put the unit on its carrier; some machines report this instead of an arrival. */
  BOUND: 'bound',
  STARTED: 'started',
  PROGRESS: 'progress',
  FINISHED: 'finished',
  RELEASED: 'released',
  TRANSFER_FAILED: 'transfer-failed',
  WITHDRAWN: 'withdrawn',
} as const;
export type JobEvent = typeof JOB_EVENT[keyof typeof JOB_EVENT];

export const JOB_RESULT = { OK: 'ok', REJECT: 'reject', HOLD: 'hold', SCRAP: 'scrap', REWORK: 'rework' } as const;
export type JobResult = typeof JOB_RESULT[keyof typeof JOB_RESULT];

export const TRANSFER_FAILURE = {
  JAM: 'jam',
  INCOMPLETE_HANDSHAKE: 'incomplete-handshake',
  CARRIER_MISMATCH: 'carrier-mismatch',
  UNREADABLE_ID: 'unreadable-id',
} as const;
export type TransferFailure = typeof TRANSFER_FAILURE[keyof typeof TRANSFER_FAILURE];

/** Commands. Every command carries a cmdId; a repeated cmdId is answered, never run twice. */
export const OP = {
  DISPATCH: 'dispatch',
  CANCEL: 'cancel',
  ENABLE: 'enable',
  DISABLE: 'disable',
  ACK_ALARM: 'ack-alarm',
  SNAPSHOT: 'snapshot',
} as const;
export type Op = typeof OP[keyof typeof OP];

export const REPLY_STATUS = { ACCEPTED: 'accepted', REFUSED: 'refused', FAILED: 'failed' } as const;
export type ReplyStatus = typeof REPLY_STATUS[keyof typeof REPLY_STATUS];
