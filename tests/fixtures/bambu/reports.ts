/**
 * Reports in the shape a Bambu P1S sends them on its LAN broker, taken from a
 * real printer with identifying fields removed: a placeholder serial, neutral
 * job names, and no network, camera or firmware details.
 */

export { SUBTASK, fullReport } from '../../../examples/workflows/bambu-printer/sim/full-report';

export const SERIAL = '01P00A000000001';
export const STATION = 'p1s-01';

let seq = 60_000;

/** A partial report: only the fields that changed, as the printer sends between full ones. */
export function partial(fields: Record<string, unknown>): Record<string, unknown> {
  return { print: { ...fields, command: 'push_status', msg: 1, sequence_id: String(seq++) } };
}

/** The printer's acknowledgement of a request it ran. */
export function accepted(command: string, sequenceId: string): Record<string, unknown> {
  return { print: { sequence_id: sequenceId, command, param: 'Metadata/plate_1.gcode', reason: 'success', result: 'success' } };
}

/** A `project_file` the printer would not run without Developer Mode: an error code and no result. */
export function refused(sequenceId: string): Record<string, unknown> {
  return { print: { sequence_id: sequenceId, command: 'project_file', param: 'Metadata/plate_1.gcode', err_code: 84033543 } };
}

/** The acknowledgement of a system request, e.g. the chamber light. */
export function systemAck(sequenceId: string): Record<string, unknown> {
  return {
    system: {
      sequence_id: sequenceId, command: 'ledctrl', led_node: 'chamber_light', led_mode: 'on', led_on_time: 500, led_off_time: 500,
      loop_times: 0, interval_time: 0, reason: 'success', result: 'success',
    },
  };
}
