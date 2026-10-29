/**
 * Reports in the shape a Bambu P1S sends them on its LAN broker, taken from a
 * real printer with identifying fields removed: a placeholder serial, neutral
 * job names, and no network, camera or firmware details.
 */

export const SERIAL = '01P00A000000001';
export const STATION = 'p1s-01';
export const SUBTASK = 'lt-print-0001-p1s-01~U-0001';

/** A full report, as a `pushall` answers, mid-print. */
export function fullReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    print: {
      upload: { status: 'idle', progress: 0, message: '' },
      nozzle_temper: 249.96875, nozzle_target_temper: 250, bed_temper: 31.625, bed_target_temper: 30, chamber_temper: 5,
      mc_print_stage: '2', heatbreak_fan_speed: '15', cooling_fan_speed: '1', big_fan1_speed: '0', big_fan2_speed: '10',
      mc_percent: 59, mc_remaining_time: 27, ams_status: 768, ams_rfid_status: 3, hw_switch_state: 1, spd_mag: 100, spd_lvl: 2,
      print_error: 0, lifecycle: 'product', wifi_signal: '-44dBm', gcode_state: 'RUNNING', gcode_file_prepare_percent: '0',
      queue_number: 0, queue_total: 0, queue_est: 0, queue_sts: 0, project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0',
      subtask_name: SUBTASK, gcode_file: `${SUBTASK}.gcode.3mf`, stg: [2, 14, 1], stg_cur: 0, print_type: 'local', home_flag: 6505751,
      mc_print_line_number: '0', mc_print_sub_stage: 0, sdcard: true, force_upgrade: false, mess_production_state: 'active',
      layer_num: 9, total_layer_num: 32, s_obj: [], filam_bak: [], fan_gear: 11796505, nozzle_diameter: '0.8', nozzle_type: 'hardened_steel',
      cali_version: 0, k: '0.0200', flag3: 8843, hms: [],
      ams: { ams: [], ams_exist_bits: '0', tray_exist_bits: '0', tray_is_bbl_bits: '0' },
      vt_tray: { id: '254', tray_type: '', tray_info_idx: '' },
      lights_report: [{ node: 'chamber_light', mode: 'on' }],
      command: 'push_status', msg: 0, sequence_id: '55482',
      ...overrides,
    },
  };
}

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
