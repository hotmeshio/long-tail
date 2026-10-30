import { describe, expect, it } from 'vitest';
import { bambuCodec } from '../../../examples/workflows/bambu-printer/codec';
import { MESSAGE_KIND, type Inspection } from '../../../lib/machines/protocol';
import type { LineDef } from '../../../types/machines';
import { SERIAL, STATION, fullReport, partial } from '../../fixtures/bambu/reports';

const ROOT = 'line/v1';
const LINE: LineDef = {
  siteId: 'site-1', lineId: 'print-1',
  machines: [{
    machineId: STATION, address: SERIAL, process: 'print', description: 'printer', carrier: 'none', cycleSec: 3600, changeoverSec: 0,
    rejectReason: 'PRINT-FAILED', recipes: { 'print-file': ['1'] }, materials: [], measurements: [], faults: {},
  }],
};
const NEXT = 'lt-print-0002-p1s-01~U-0002';

const report = (codec: ReturnType<typeof bambuCodec>, msg: Record<string, unknown>) => codec.decode(`${ROOT}/site-1/print-1/${SERIAL}/report`, JSON.stringify(msg));
const jobEvents = (seen: Inspection[]) => seen.filter((s) => s.parsed?.kind === MESSAGE_KIND.JOB).map((s) => `${s.body?.body.event}:${s.body?.body.unitId}`);

describe('bambu codec: where one print ends and the next begins', () => {
  it('ignores the last print\'s end while the next print\'s first reports still carry it', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport({ gcode_state: 'FINISH', mc_percent: 100 }));
    // The printer names the new job before its state moves on.
    expect(jobEvents(report(codec, partial({ subtask_name: NEXT })))).toEqual([]);
    expect(jobEvents(report(codec, partial({ gcode_state: 'FAILED' })))).toEqual([]);
    expect(jobEvents(report(codec, partial({ gcode_state: 'RUNNING', stg_cur: 2, mc_percent: 0 })))).toEqual([]);
    expect(jobEvents(report(codec, partial({ stg_cur: 0, layer_num: 1, mc_percent: 3 })))).toEqual(['started:U-0002', 'progress:U-0002']);
    expect(jobEvents(report(codec, partial({ gcode_state: 'FINISH', mc_percent: 100 })))).toEqual(['arrived:U-0002', 'finished:U-0002']);
  });

  it('reads a print that went back to idle without finishing as withdrawn', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport({ gcode_state: 'PREPARE', stg_cur: 1, mc_percent: 0, layer_num: 0 }));
    const idle = report(codec, partial({ gcode_state: 'IDLE', stg_cur: 255 }));
    expect(jobEvents(idle)).toEqual(['withdrawn:U-0001']);
    expect(idle[0].body?.body.reason).toBe('did-not-print');
  });

  it('reads a cancel as the job withdrawn because it was cancelled, with no alarm for the brief cancel code', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    expect(report(codec, partial({ print_error: 0x0300400c })).filter((s) => s.parsed?.kind === MESSAGE_KIND.ALARM)).toEqual([]);
    const ended = report(codec, partial({ gcode_state: 'FAILED', print_error: 0 }));
    expect(jobEvents(ended)).toEqual(['withdrawn:U-0001']);
    expect(ended.find((s) => s.parsed?.kind === MESSAGE_KIND.JOB)?.body?.body.reason).toBe('cancelled');
  });

  it('takes an acknowledgement with errno 0 and no result as accepted', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const [reply] = report(codec, { print: { sequence_id: 'row-9:command', command: 'set_fan', errno: 0 } });
    expect(reply.body?.body).toMatchObject({ cmdId: 'row-9:command', status: 'accepted' });
  });

  it('trusts the end of a print it sees first, as after a restart, so the print row still resolves', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    expect(jobEvents(report(codec, fullReport({ gcode_state: 'FINISH', mc_percent: 100 })))).toEqual(['arrived:U-0001', 'finished:U-0001']);
  });
});
