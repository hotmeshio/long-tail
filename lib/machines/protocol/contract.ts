/**
 * The line protocol as JSON Schema plus the rules a schema cannot express.
 * Known fields are checked; unknown fields are allowed, so a machine on a
 * newer minor version can add fields without breaking older gateways. The
 * gateway checks every inbound message; the tests check everything the mock sends.
 */

import Ajv, { type ValidateFunction } from 'ajv';

import {
  JOB_EVENT, JOB_RESULT, LEVEL, MAX_PAYLOAD_BYTES, MODE, OP, REPLY_STATUS, TRANSFER_FAILURE,
} from './constants';
import { parsePayload, type Envelope } from './envelope';
import { MESSAGE_KIND, parseTopic, type MessageKind, type ParsedTopic } from './topics';

type Schema = Record<string, any>;

const STR = { type: 'string' };
const STR_N = { type: ['string', 'null'] };
const NUM = { type: 'number' };
const INT0 = { type: 'integer', minimum: 0 };
const BOOL = { type: 'boolean' };
const TS = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' };
const TS_N = { anyOf: [TS, { type: 'null' }] };
const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };

const oneOf = (o: Record<string, string>, nullable = false): Schema => ({ enum: nullable ? [...Object.values(o), null] : Object.values(o) });

function shape(props: Schema, optional: string[] = []): Schema {
  return { type: 'object', properties: props, required: Object.keys(props).filter((k) => !optional.includes(k)) };
}

const ENVELOPE = shape({
  v: { type: 'string', pattern: '^1(\\.\\d+)?$' },
  id: UUID,
  at: TS,
  source: shape({ site: STR, line: STR, machine: STR, station: STR }, ['station']),
  body: { type: 'object' },
});

const RECIPE = { anyOf: [shape({ id: STR, version: STR }), { type: 'null' }] };

const BODY: Record<MessageKind, Schema> = {
  [MESSAGE_KIND.PRESENCE]: shape({ online: BOOL, software: STR }, ['software']),
  [MESSAGE_KIND.SNAPSHOT]: shape({
    bootId: STR, software: STR, mode: oneOf(MODE), enabled: BOOL, recipe: RECIPE,
    jobs: { type: 'array', items: shape({ jobId: STR, units: { type: 'array', items: STR }, status: STR }) },
    alarms: { type: 'array', items: STR },
    cycles: INT0,
  }),
  [MESSAGE_KIND.JOB]: shape({
    event: oneOf(JOB_EVENT), jobId: STR, unitId: STR, orderRef: STR, recipe: RECIPE, carrierId: STR_N, peer: STR_N,
    result: oneOf(JOB_RESULT), reason: STR_N,
    measurements: {
      type: 'array',
      items: shape({ name: STR, value: NUM, unit: STR_N, min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] }, ok: BOOL }),
    },
    materials: { type: 'array', items: shape({ material: STR, lot: STR }) },
    startedAt: TS, endedAt: TS, durationMs: INT0, failure: oneOf(TRANSFER_FAILURE),
    percent: { type: 'number', minimum: 0, maximum: 100 }, remainingSec: INT0, stage: STR, detail: { type: 'object' },
  }, ['jobId', 'unitId', 'peer', 'result', 'reason', 'measurements', 'materials', 'startedAt', 'endedAt', 'durationMs', 'failure', 'percent', 'remainingSec', 'stage', 'detail']),
  [MESSAGE_KIND.ALARM]: shape({
    alarmId: STR, code: STR, level: oneOf(LEVEL), text: STR, active: BOOL,
    raisedAt: TS, clearedAt: TS_N, clearedBy: STR_N, ackedBy: STR_N, ackedAt: TS_N,
    zone: STR_N, autoClears: BOOL, action: STR_N, jobId: STR_N,
  }),
  [MESSAGE_KIND.TELEMETRY]: shape({ readings: { type: 'object', additionalProperties: NUM } }),
  [MESSAGE_KIND.CMD]: shape({ cmdId: STR, op: oneOf(OP), args: { type: 'object' } }),
  [MESSAGE_KIND.REPLY]: shape({ cmdId: STR, status: oneOf(REPLY_STATUS), reason: STR }),
  [MESSAGE_KIND.REPORT]: { type: 'object' },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const ENVELOPE_V = ajv.compile(ENVELOPE);
const BODY_V = Object.fromEntries(Object.entries(BODY).map(([k, s]) => [k, ajv.compile(s)])) as Record<MessageKind, ValidateFunction>;

const RETAINED: readonly MessageKind[] = [MESSAGE_KIND.PRESENCE, MESSAGE_KIND.SNAPSHOT, MESSAGE_KIND.ALARM];

export interface Inspection {
  parsed: ParsedTopic | null;
  body: Envelope | null;
  violations: string[];
  /** Set by a codec whose machines await a receipt: the id to confirm once the gateway is done with the message. */
  receiptId?: string;
  /** The station the message says it comes from, when the wire names one apart from the address (a line that learns addresses). */
  claim?: string;
}

const errorsOf = (prefix: string, fn: ValidateFunction) =>
  (fn.errors ?? []).map((e) => `${prefix}: ${e.instancePath || '.'} ${e.message}`);

/** Validate one message. `retained` is the publisher's flag when the transport reports it. */
export function inspectMessage(root: string, topic: string, raw: string | Buffer, retained?: boolean): Inspection {
  const parsed = parseTopic(root, topic);
  if (!parsed) return { parsed, body: null, violations: ['unknown topic'] };
  const violations: string[] = [];
  const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length;
  if (size > MAX_PAYLOAD_BYTES) violations.push(`payload ${size} B exceeds ${MAX_PAYLOAD_BYTES} B`);
  if (size === 0) {
    if (parsed.kind !== MESSAGE_KIND.ALARM) violations.push('empty payload');
    return { parsed, body: null, violations };
  }
  const body = parsePayload(raw);
  if (!body) return { parsed, body: null, violations: [...violations, 'not a JSON object'] };
  if (!ENVELOPE_V(body)) violations.push(...errorsOf('envelope', ENVELOPE_V));
  const bodyV = BODY_V[parsed.kind];
  if (!bodyV(body.body ?? {})) violations.push(...errorsOf(parsed.kind, bodyV));
  violations.push(...crossFieldRules(parsed, body, retained));
  return { parsed, body, violations };
}

/** Job events a receiver may report naming only the carrier it scanned. */
const CARRIER_EVENTS: string[] = [JOB_EVENT.ARRIVED, JOB_EVENT.TRANSFER_FAILED];

function crossFieldRules(parsed: ParsedTopic, env: Envelope, retained?: boolean): string[] {
  const out: string[] = [];
  const b: Record<string, any> = env.body ?? {};
  const { ident, kind, key } = parsed;
  const s = env.source ?? ({} as Envelope['source']);
  if (s.site !== ident.siteId || s.line !== ident.lineId || s.machine !== ident.machineId) out.push('source disagrees with the topic');
  if (kind === MESSAGE_KIND.ALARM && b.alarmId !== key) out.push('alarmId disagrees with the topic');
  if (kind === MESSAGE_KIND.JOB) {
    // A scan at a receiver may read only the carrier; every other job event names its unit and job.
    const byCarrier = CARRIER_EVENTS.includes(b.event) && typeof b.carrierId === 'string';
    if (b.unitId === undefined && !byCarrier) out.push(`${b.event} without a unitId`);
    if (b.jobId === undefined && !byCarrier) out.push(`${b.event} without a jobId`);
    if (b.event === JOB_EVENT.FINISHED) {
      for (const field of ['result', 'measurements', 'materials', 'startedAt', 'endedAt']) {
        if (!(field in b)) out.push(`finished without ${field}`);
      }
    }
    if (b.result && b.result !== JOB_RESULT.OK && !b.reason) out.push(`${b.result} without a reason`);
    if (b.event === JOB_EVENT.TRANSFER_FAILED && !b.failure) out.push('transfer-failed without a failure');
    // The schema has already reported a malformed list; these rules read only well-formed entries.
    for (const m of Array.isArray(b.measurements) ? b.measurements : []) {
      if (!m || typeof m !== 'object') continue;
      if (m.min != null && m.max != null && (m.min <= m.value && m.value <= m.max) !== m.ok) out.push(`${m.name}: ok disagrees with min/max`);
    }
  }
  if (retained === undefined) return out;
  if ((kind === MESSAGE_KIND.PRESENCE || kind === MESSAGE_KIND.SNAPSHOT) && !retained) out.push(`${kind} not retained`);
  if (kind === MESSAGE_KIND.ALARM && b.active === true && !retained) out.push('active alarm not retained');
  if (!RETAINED.includes(kind) && retained) out.push(`${kind} must not be retained`);
  return out;
}
