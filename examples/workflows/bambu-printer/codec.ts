/**
 * Bambu printers on the line protocol. Each printer hosts its own MQTT
 * broker; the site broker bridges its `device/<serial>/report` in and
 * `device/<serial>/request` out under `{root}/{site}/{line}/{serial}/`, and
 * publishes the bridge's state on `.../bridge`. This codec reads those topics
 * as line-protocol events and writes the gateway's commands as printer
 * requests. Workflows and rows never see any of it.
 *
 * A print runs under `<jobId>~<unitId>`, so every report names its row. The
 * print row is accepted when the printer acknowledges `project_file`, and it
 * resolves when the print finishes: FINISH is both the unit's arrival and
 * the job's finished record. Start, progress, and errors in between become
 * the lifecycle events the gateway notes on that row.
 */

import { createHash } from 'crypto';
import type { LineDef } from '../../../types/machines';
import {
  CHANNEL, JOB_EVENT, JOB_RESULT, LEVEL, MESSAGE_KIND, MODE, OP, REPLY_STATUS, buildEnvelope, inspectMessage, machineTopic,
  type Inspection, type LineCodec, type MachineCommand, type MachineIdent, type WireMessage,
} from '../../../lib/machines/protocol';
import { DEFAULT_TOPIC_ROOT } from '../../../services/machines/config';
import { CANCEL_CODES, describeError } from './catalog';
import {
  ACK_SUCCESS, BED_TYPE_AUTO, DEFAULT_PLATE, PHASE, PRINTER_COMMAND, PROGRESS_FIELDS, errorCode, isFullReport, jobOf, phaseOf, subtaskName,
  type Phase, type PrinterReport,
} from './report';

export const BAMBU_CHANNEL = { REPORT: 'report', REQUEST: 'request', BRIDGE: 'bridge' } as const;

/** The alarm a printer's `print_error` raises; one at a time, as the printer reports one. */
export const PRINT_ERROR_ALARM = 'print-error';

const BRIDGE_UP = '1';
const WORKING: readonly Phase[] = [PHASE.PREPARING, PHASE.PRINTING, PHASE.PAUSED];
const DID_NOT_PRINT = 'did-not-print';
const CANCELLED = 'cancelled';
const SOFTWARE = 'bambu';
/** Which edge of an alarm a message is, for its envelope id. */
const ALARM_EDGE = { RAISE: 'raise', CLEAR: 'clear' } as const;
const SEEN_LIMIT = 500;

interface PrinterState {
  report: PrinterReport;
  job?: string;
  /** A job named after another, not yet seen working: its first reports may still carry the last job's end. */
  fresh?: string;
  phase?: Phase;
  started?: string;
  percent?: number;
  error?: { code: string; raisedAt: string };
  /** The snapshot command a full report answers. */
  asked?: string;
  /** The printer flashed a cancel code during this print; it shows only briefly, so it is held until the next print. */
  cancelled?: boolean;
}

export interface BambuCodecOptions {
  root: string;
  line: LineDef;
}

/** Why a print ended without finishing: cancelled when the printer said so, else its error, else failed. */
function endReason(s: PrinterState): string {
  if (s.cancelled) return CANCELLED;
  return s.error?.code ?? PHASE.FAILED;
}

/** A deterministic envelope id, so a replayed report yields the same messages. */
function stableId(...parts: string[]): string {
  const h = createHash('sha1').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function bambuCodec(opts: BambuCodecOptions): LineCodec {
  const { root, line } = opts;
  const rootLevels = root.split('/').length;
  const stations = new Map(line.machines.map((m) => [m.address ?? m.machineId, m.machineId]));
  const printers = new Map<string, PrinterState>();
  const seen = new Map<string, Inspection[]>();

  const stateOf = (serial: string) => {
    let s = printers.get(serial);
    if (!s) printers.set(serial, (s = { report: {} }));
    return s;
  };

  /** A line-protocol message from `ident` on `channel`, validated as the generic contract would. */
  const message = (ident: MachineIdent, channel: string, body: Record<string, unknown>, ...idParts: string[]): Inspection => {
    const env = buildEnvelope(ident, body, { id: stableId(ident.machineId, channel, ...idParts) });
    const inspected = inspectMessage(root, machineTopic(root, ident, channel), JSON.stringify(env));
    return { ...inspected, parsed: inspected.parsed && { ...inspected.parsed, ident } };
  };

  const jobEvent = (ident: MachineIdent, job: { jobId: string; unitId: string }, event: string, extra: Record<string, unknown> = {}) =>
    message(ident, CHANNEL.JOB, { event, jobId: job.jobId, unitId: job.unitId, orderRef: job.jobId, recipe: null, carrierId: null, ...extra }, job.jobId, event, JSON.stringify(extra));

  /** The printer acknowledged a request: the reply under the request's sequence id. */
  function replyOf(ident: MachineIdent, ack: Record<string, any>): Inspection[] {
    if (typeof ack.sequence_id !== 'string' || !ack.sequence_id) return [];
    // Older firmware answers with `result`, newer with `errno: 0` alone.
    const ok = ack.result === ACK_SUCCESS || (ack.result === undefined && ack.errno === 0);
    const reason = ok ? '' : typeof ack.err_code === 'number' ? errorCode(ack.err_code) : String(ack.reason ?? ack.result ?? REPLY_STATUS.REFUSED);
    return [message(ident, CHANNEL.REPLY, { cmdId: ack.sequence_id, status: ok ? REPLY_STATUS.ACCEPTED : REPLY_STATUS.REFUSED, reason }, ack.sequence_id)];
  }

  function snapshotOf(ident: MachineIdent, s: PrinterState): Inspection[] {
    const job = jobOf(s.report.subtask_name);
    const out = [message(ident, CHANNEL.SNAPSHOT, {
      bootId: ident.address ?? ident.machineId, software: SOFTWARE, mode: s.phase === PHASE.IDLE ? MODE.IDLE : MODE.RUNNING, enabled: true, recipe: null,
      jobs: job ? [{ jobId: job.jobId, units: [job.unitId], status: s.phase ?? PHASE.IDLE }] : [], alarms: s.error ? [PRINT_ERROR_ALARM] : [], cycles: 0,
    }, MESSAGE_KIND.SNAPSHOT, String(s.report.sequence_id ?? ''))];
    if (s.asked) out.push(message(ident, CHANNEL.REPLY, { cmdId: s.asked, status: REPLY_STATUS.ACCEPTED, reason: '' }, s.asked));
    s.asked = undefined;
    return out;
  }

  /** `print_error` raised, or back to 0: the alarm and its clear. */
  function alarmOf(ident: MachineIdent, s: PrinterState): Inspection[] {
    const n = s.report.print_error;
    if (typeof n !== 'number') return [];
    const code = n === 0 ? null : errorCode(n);
    if (code && CANCEL_CODES.includes(code)) {
      s.cancelled = true;
      return [];
    }
    if (code === (s.error?.code ?? null)) return [];
    const job = jobOf(s.report.subtask_name);
    const now = new Date().toISOString();
    const channel = `${CHANNEL.ALARM}/${PRINT_ERROR_ALARM}`;
    const base = { alarmId: PRINT_ERROR_ALARM, level: LEVEL.CRITICAL, zone: null, autoClears: false, action: null, jobId: job?.jobId ?? null, ackedBy: null, ackedAt: null };
    const out: Inspection[] = [];
    if (s.error) {
      out.push(message(ident, channel, { ...base, code: s.error.code, text: describeError(s.error.code), active: false, raisedAt: s.error.raisedAt, clearedAt: now, clearedBy: null }, ALARM_EDGE.CLEAR, s.error.raisedAt));
    }
    s.error = code ? { code, raisedAt: now } : undefined;
    if (code) out.push(message(ident, channel, { ...base, code, text: describeError(code), active: true, raisedAt: now, clearedAt: null, clearedBy: null }, ALARM_EDGE.RAISE, now));
    return out;
  }

  /** Our print's phase changes and progress, from the merged report and the message just merged. */
  function jobOfReport(ident: MachineIdent, s: PrinterState, print: PrinterReport): Inspection[] {
    const job = jobOf(s.report.subtask_name);
    if (!job) return [];
    const key = subtaskName(job.jobId, job.unitId);
    if (key !== s.job) {
      // The last print's progress stays in the merged report until the printer reports this one's.
      if (s.job !== undefined) for (const f of PROGRESS_FIELDS) if (!(f in print)) delete s.report[f];
      Object.assign(s, { fresh: s.job === undefined ? undefined : key, job: key, phase: undefined, percent: undefined, cancelled: false });
    }
    const phase = phaseOf(s.report);
    const working = WORKING.includes(phase);
    if (working) s.fresh = undefined;
    if (s.fresh === key) return [];
    const out: Inspection[] = [];
    if (phase !== s.phase) {
      if ((phase === PHASE.PRINTING || phase === PHASE.PAUSED) && s.started !== key) {
        s.started = key;
        out.push(jobEvent(ident, job, JOB_EVENT.STARTED));
      }
      if (phase === PHASE.FINISHED) {
        const at = new Date().toISOString();
        out.push(jobEvent(ident, job, JOB_EVENT.ARRIVED), jobEvent(ident, job, JOB_EVENT.FINISHED, {
          result: JOB_RESULT.OK, reason: null, measurements: [], materials: [], startedAt: at, endedAt: at,
        }));
      }
      if (phase === PHASE.FAILED) out.push(jobEvent(ident, job, JOB_EVENT.WITHDRAWN, { reason: endReason(s) }));
      // Back to idle with no finish: the print never ran to its end (a failed bed leveling, say).
      if (phase === PHASE.IDLE && s.phase && WORKING.includes(s.phase)) out.push(jobEvent(ident, job, JOB_EVENT.WITHDRAWN, { reason: s.error?.code ?? DID_NOT_PRINT }));
      s.phase = phase;
    }
    const percent = s.report.mc_percent;
    if ((phase === PHASE.PRINTING || phase === PHASE.PAUSED) && typeof percent === 'number' && percent !== s.percent) {
      s.percent = percent;
      const minutes = s.report.mc_remaining_time;
      out.push(jobEvent(ident, job, JOB_EVENT.PROGRESS, {
        percent, ...(typeof minutes === 'number' ? { remainingSec: minutes * 60 } : {}),
        detail: { layer: s.report.layer_num ?? null, layers: s.report.total_layer_num ?? null },
      }));
    }
    return out;
  }

  function fromReport(ident: MachineIdent, serial: string, raw: string): Inspection[] {
    let msg: Record<string, any>;
    try { msg = JSON.parse(raw); } catch { return []; }
    if (msg?.system) return replyOf(ident, msg.system);
    const print: PrinterReport | undefined = msg?.print;
    if (!print || typeof print !== 'object') return [];
    if (print.command !== PRINTER_COMMAND.PUSH_STATUS) return replyOf(ident, print);
    const s = stateOf(serial);
    Object.assign(s.report, print);
    const events = [...alarmOf(ident, s), ...jobOfReport(ident, s, print)];
    return isFullReport(print) ? [...events, ...snapshotOf(ident, s)] : events;
  }

  function decodeFresh(topic: string, payload: string): Inspection[] {
    const levels = topic.split('/');
    if (levels.length !== rootLevels + 4 || levels.slice(0, rootLevels).join('/') !== root) return [];
    const [siteId, lineId, serial, channel] = levels.slice(rootLevels);
    const machineId = stations.get(serial);
    if (!machineId || siteId !== line.siteId || lineId !== line.lineId) return [];
    const ident: MachineIdent = { siteId, lineId, machineId, address: serial };
    if (channel === BAMBU_CHANNEL.BRIDGE) return [message(ident, CHANNEL.PRESENCE, { online: payload.trim() === BRIDGE_UP }, payload.trim())];
    if (channel === BAMBU_CHANNEL.REPORT) return fromReport(ident, serial, payload);
    return [];
  }

  /** The request for a command, on the printer's request topic. */
  function request(ident: MachineIdent, body: Record<string, unknown>): WireMessage[] {
    const serial = ident.address ?? ident.machineId;
    return [{ topic: `${root}/${ident.siteId}/${ident.lineId}/${serial}/${BAMBU_CHANNEL.REQUEST}`, payload: JSON.stringify(body) }];
  }

  function printFile(ident: MachineIdent, command: MachineCommand): WireMessage[] {
    const args = command.args as Record<string, any>;
    const unit = Array.isArray(args.units) ? args.units[0] : null;
    const url = unit?.artifact?.url ?? args.artifact?.url;
    if (!unit?.unitId || typeof url !== 'string' || !url) return [];
    const parameters = { ...(args.parameters ?? {}), ...(unit.parameters ?? {}) };
    return request(ident, {
      print: {
        sequence_id: command.cmdId, command: PRINTER_COMMAND.PROJECT_FILE, param: parameters.plate ?? DEFAULT_PLATE,
        project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0', subtask_name: subtaskName(String(args.jobId), unit.unitId),
        url, md5: '', timelapse: false, bed_type: BED_TYPE_AUTO, bed_levelling: parameters.bedLevelling !== false,
        flow_cali: false, vibration_cali: false, layer_inspect: false, use_ams: parameters.useAms === true, ams_mapping: [],
      },
    });
  }

  return {
    root,
    channels: { events: [BAMBU_CHANNEL.REPORT, BAMBU_CHANNEL.BRIDGE], telemetry: [], commands: [BAMBU_CHANNEL.REQUEST] },
    topicFor: (scope, channel) => `${root}/${scope.siteId ?? '+'}/${scope.lineId ?? '+'}/${scope.address ?? '+'}/${channel}`,
    unitsPerDispatch: 1,
    snapshotOnStart: true,
    decode(topic, payload) {
      const key = `${topic}\n${payload}`;
      const known = seen.get(key);
      if (known) return known;
      const out = decodeFresh(topic, payload);
      seen.set(key, out);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value!);
      return out;
    },
    encode(ident, command) {
      const s = stateOf(ident.address ?? ident.machineId);
      switch (command.op) {
        case OP.DISPATCH:
          return printFile(ident, command);
        case OP.PAUSE:
          return request(ident, { print: { sequence_id: command.cmdId, command: PRINTER_COMMAND.PAUSE, param: '' } });
        case OP.RESUME:
          return request(ident, { print: { sequence_id: command.cmdId, command: PRINTER_COMMAND.RESUME, param: '' } });
        case OP.CANCEL: {
          const running = jobOf(s.report.subtask_name);
          const live = s.phase !== PHASE.FINISHED && s.phase !== PHASE.FAILED && s.phase !== PHASE.IDLE;
          return running && live && running.jobId === command.args.jobId
            ? request(ident, { print: { sequence_id: command.cmdId, command: PRINTER_COMMAND.STOP, param: '' } })
            : [];
        }
        case OP.SNAPSHOT:
          s.asked = command.cmdId;
          return request(ident, { pushing: { sequence_id: command.cmdId, command: PRINTER_COMMAND.PUSH_ALL } });
        default:
          return [];
      }
    },
  };
}

/** For MACHINE_CODEC_MODULE: the codec for a line of Bambu printers. */
export function createCodec(line: LineDef): LineCodec {
  return bambuCodec({ root: process.env.MACHINE_TOPIC_ROOT || DEFAULT_TOPIC_ROOT, line });
}
