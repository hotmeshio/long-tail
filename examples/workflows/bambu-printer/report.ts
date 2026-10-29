/**
 * A Bambu printer's report, as its LAN MQTT broker sends it on
 * `device/<serial>/report`. A `pushall` answers with every field; after that
 * the printer sends only the fields that changed, so the codec keeps one
 * merged report per printer and reads the print's phase from it.
 */

/** What the printer reads on its request topic and writes on its report topic. */
export const PRINTER_COMMAND = {
  PUSH_STATUS: 'push_status',
  PUSH_ALL: 'pushall',
  PROJECT_FILE: 'project_file',
  PAUSE: 'pause',
  RESUME: 'resume',
  STOP: 'stop',
} as const;

/** The `result` of a request the printer ran. */
export const ACK_SUCCESS = 'success';

/** The plate a single-plate project prints, inside its .3mf. */
export const DEFAULT_PLATE = 'Metadata/plate_1.gcode';

/** The bed type a print request leaves to the printer. */
export const BED_TYPE_AUTO = 'auto';

export const PRINT_STATE = {
  IDLE: 'IDLE',
  PREPARE: 'PREPARE',
  RUNNING: 'RUNNING',
  PAUSE: 'PAUSE',
  FINISH: 'FINISH',
  FAILED: 'FAILED',
} as const;

/** Where a print stands, read from the merged report. */
export const PHASE = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  PRINTING: 'printing',
  PAUSED: 'paused',
  FINISHED: 'finished',
  FAILED: 'failed',
} as const;
export type Phase = typeof PHASE[keyof typeof PHASE];

/** `stg_cur` while the printer lays down material; other values are heating, leveling and the like. */
const STAGE_PRINTING = 0;

/** Fields a full report always carries and a partial one carries only when they change. */
const FULL_REPORT_FIELDS = ['gcode_state', 'subtask_name', 'mc_percent', 'print_error'];

export interface PrinterReport {
  command?: string;
  sequence_id?: string;
  gcode_state?: string;
  stg_cur?: number;
  mc_percent?: number;
  mc_remaining_time?: number;
  layer_num?: number;
  total_layer_num?: number;
  subtask_name?: string;
  print_error?: number;
  [field: string]: unknown;
}

/** Fields that describe one print's progress; a new print starts without the last one's. */
export const PROGRESS_FIELDS = ['mc_percent', 'mc_remaining_time', 'layer_num', 'total_layer_num'] as const;

export function isFullReport(print: PrinterReport): boolean {
  return FULL_REPORT_FIELDS.every((f) => f in print);
}

export function phaseOf(r: PrinterReport): Phase {
  switch (r.gcode_state) {
    case PRINT_STATE.PREPARE:
      return PHASE.PREPARING;
    case PRINT_STATE.RUNNING: {
      // The stage says so when the printer reports one; otherwise a layer under way does.
      const laying = typeof r.stg_cur === 'number' ? r.stg_cur === STAGE_PRINTING : typeof r.layer_num === 'number' && r.layer_num >= 1;
      return laying ? PHASE.PRINTING : PHASE.PREPARING;
    }
    case PRINT_STATE.PAUSE:
      return PHASE.PAUSED;
    case PRINT_STATE.FINISH:
      return PHASE.FINISHED;
    case PRINT_STATE.FAILED:
      return PHASE.FAILED;
    default:
      return PHASE.IDLE;
  }
}

const JOB_SEPARATOR = '~';

/** The name a print runs under: its job and unit, so both read back from any report. */
export function subtaskName(jobId: string, unitId: string): string {
  return `${jobId}${JOB_SEPARATOR}${unitId}`;
}

/** The job and unit a print was started for; null for a print started elsewhere. */
export function jobOf(subtask: unknown): { jobId: string; unitId: string } | null {
  if (typeof subtask !== 'string') return null;
  const at = subtask.lastIndexOf(JOB_SEPARATOR);
  if (at <= 0 || at === subtask.length - 1) return null;
  return { jobId: subtask.slice(0, at), unitId: subtask.slice(at + 1) };
}

/** A `print_error` as Bambu writes it, e.g. 134184977 → `07FF-8011`. */
export function errorCode(n: number): string {
  const hex = (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
