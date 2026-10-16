/**
 * The line protocol as JSON Schema plus the rules a schema cannot express.
 * Bodies are closed objects, so an unknown field is a violation. The gateway
 * checks every inbound message; the tests check everything the mock sends.
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

function closed(props: Schema, optional: string[] = []): Schema {
  return { type: 'object', properties: props, required: Object.keys(props).filter((k) => !optional.includes(k)), additionalProperties: false };
}

const ENVELOPE = closed({
  v: { type: 'string', pattern: '^1(\\.\\d+)?$' },
  id: UUID,
  at: TS,
  source: closed({ site: STR, line: STR, machine: STR }),
  body: { type: 'object' },
});

const RECIPE = { anyOf: [closed({ id: STR, version: STR }), { type: 'null' }] };

const BODY: Record<MessageKind, Schema> = {
  [MESSAGE_KIND.PRESENCE]: closed({ online: BOOL }),
  [MESSAGE_KIND.SNAPSHOT]: closed({
    mode: oneOf(MODE), enabled: BOOL, recipe: RECIPE,
    jobs: { type: 'array', items: closed({ jobId: STR, unitId: STR, status: STR }) },
    alarms: { type: 'array', items: STR },
    cycles: INT0,
  }),
  [MESSAGE_KIND.JOB]: closed({
    event: oneOf(JOB_EVENT), jobId: STR, unitId: STR, orderRef: STR, recipe: RECIPE, carrierId: STR_N, peer: STR_N,
    result: oneOf(JOB_RESULT), reason: STR_N,
    measurements: {
      type: 'array',
      items: closed({ name: STR, value: NUM, unit: STR_N, min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] }, ok: BOOL }),
    },
    materials: { type: 'array', items: closed({ material: STR, lot: STR }) },
    startedAt: TS, endedAt: TS, durationMs: INT0, failure: oneOf(TRANSFER_FAILURE),
  }, ['peer', 'result', 'reason', 'measurements', 'materials', 'startedAt', 'endedAt', 'durationMs', 'failure']),
  [MESSAGE_KIND.ALARM]: closed({
    alarmId: STR, code: STR, level: oneOf(LEVEL), text: STR, active: BOOL,
    raisedAt: TS, clearedAt: TS_N, ackedBy: STR_N, ackedAt: TS_N,
    zone: STR_N, autoClears: BOOL, action: STR_N, jobId: STR_N,
  }),
  [MESSAGE_KIND.TELEMETRY]: closed({ readings: { type: 'object', additionalProperties: NUM } }),
  [MESSAGE_KIND.CMD]: closed({ cmdId: STR, op: oneOf(OP), args: { type: 'object' } }),
  [MESSAGE_KIND.REPLY]: closed({ cmdId: STR, status: oneOf(REPLY_STATUS), reason: STR }),
};

const ajv = new Ajv({ allErrors: true, strict: false });
const ENVELOPE_V = ajv.compile(ENVELOPE);
const BODY_V = Object.fromEntries(Object.entries(BODY).map(([k, s]) => [k, ajv.compile(s)])) as Record<MessageKind, ValidateFunction>;

const RETAINED: readonly MessageKind[] = [MESSAGE_KIND.PRESENCE, MESSAGE_KIND.SNAPSHOT, MESSAGE_KIND.ALARM];

export interface Inspection {
  parsed: ParsedTopic | null;
  body: Envelope | null;
  violations: string[];
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

function crossFieldRules(parsed: ParsedTopic, env: Envelope, retained?: boolean): string[] {
  const out: string[] = [];
  const b: Record<string, any> = env.body ?? {};
  const { ident, kind, key } = parsed;
  const s = env.source ?? ({} as Envelope['source']);
  if (s.site !== ident.siteId || s.line !== ident.lineId || s.machine !== ident.machineId) out.push('source disagrees with the topic');
  if (kind === MESSAGE_KIND.ALARM && b.alarmId !== key) out.push('alarmId disagrees with the topic');
  if (kind === MESSAGE_KIND.JOB) {
    if (b.event === JOB_EVENT.FINISHED) {
      for (const field of ['result', 'measurements', 'materials', 'startedAt', 'endedAt']) {
        if (!(field in b)) out.push(`finished without ${field}`);
      }
    }
    if (b.result && b.result !== JOB_RESULT.OK && !b.reason) out.push(`${b.result} without a reason`);
    if (b.event === JOB_EVENT.TRANSFER_FAILED && !b.failure) out.push('transfer-failed without a failure');
    for (const m of b.measurements ?? []) {
      if (m.min != null && m.max != null && (m.min <= m.value && m.value <= m.max) !== m.ok) out.push(`${m.name}: ok disagrees with min/max`);
    }
  }
  if (retained === undefined) return out;
  if ((kind === MESSAGE_KIND.PRESENCE || kind === MESSAGE_KIND.SNAPSHOT) && !retained) out.push(`${kind} not retained`);
  if (kind === MESSAGE_KIND.ALARM && b.active === true && !retained) out.push('active alarm not retained');
  if (!RETAINED.includes(kind) && retained) out.push(`${kind} must not be retained`);
  return out;
}
