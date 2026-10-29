import { describe, expect, it } from 'vitest';
import { bambuCodec, createCodec } from '../../../examples/workflows/bambu-printer/codec';
import { CHANNEL, JOB_EVENT, MESSAGE_KIND, OP, REPLY_STATUS, type Inspection, type LineCodec } from '../../../lib/machines/protocol';
import type { LineDef } from '../../../types/machines';
import { SERIAL, STATION, SUBTASK, accepted, fullReport, partial, refused, systemAck } from '../../fixtures/bambu/reports';

const ROOT = 'line/v1';
const LINE: LineDef = {
  siteId: 'site-1', lineId: 'print-1',
  machines: [{
    machineId: STATION, address: SERIAL, process: 'print', description: 'printer', carrier: 'none', cycleSec: 3600, changeoverSec: 0,
    rejectReason: 'PRINT-FAILED', recipes: { 'print-file': ['1'] }, materials: [], measurements: [], faults: {},
  }],
};
const prefix = `${ROOT}/site-1/print-1/${SERIAL}`;
const ident = { siteId: 'site-1', lineId: 'print-1', machineId: STATION, address: SERIAL };

const report = (codec: LineCodec, msg: Record<string, unknown>) => codec.decode(`${prefix}/report`, JSON.stringify(msg));
const kinds = (seen: Inspection[]) => seen.map((s) => (s.parsed?.kind === MESSAGE_KIND.JOB ? `job:${s.body?.body.event}` : s.parsed?.kind));
const bodies = (seen: Inspection[]) => seen.map((s) => s.body?.body as Record<string, any>);
const valid = (seen: Inspection[]) => expect(seen.flatMap((s) => s.violations)).toEqual([]);

describe('bambu codec: decode', () => {
  it('reads the bridge state as presence, from the station the serial names', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const up = codec.decode(`${prefix}/bridge`, '1');
    expect(up[0].parsed).toMatchObject({ kind: MESSAGE_KIND.PRESENCE, ident });
    expect(up[0].body?.body).toEqual({ online: true });
    expect(codec.decode(`${prefix}/bridge`, '0')[0].body?.body).toEqual({ online: false });
    valid(up);
  });

  it('ignores its own requests, other lines, and printers not on the line', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    expect(codec.decode(`${prefix}/request`, '{}')).toEqual([]);
    expect(codec.decode(`${ROOT}/site-1/other/${SERIAL}/report`, JSON.stringify(fullReport()))).toEqual([]);
    expect(codec.decode(`${ROOT}/site-1/print-1/01P00A999999999/report`, JSON.stringify(fullReport()))).toEqual([]);
  });

  it('reads a full report of its print as started, progress and a snapshot naming the job', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const seen = report(codec, fullReport());
    valid(seen);
    expect(kinds(seen)).toEqual(['job:started', 'job:progress', MESSAGE_KIND.SNAPSHOT]);
    expect(bodies(seen)[0]).toMatchObject({ jobId: 'lt-print-0001-p1s-01', unitId: 'U-0001' });
    expect(bodies(seen)[1]).toMatchObject({ percent: 59, remainingSec: 1620, detail: { layer: 9, layers: 32 } });
    expect(bodies(seen)[2].jobs).toEqual([{ jobId: 'lt-print-0001-p1s-01', units: ['U-0001'], status: 'printing' }]);
  });

  it('reads a print started elsewhere as a snapshot with no job', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const seen = report(codec, fullReport({ subtask_name: 'someone-elses-print', gcode_state: 'IDLE' }));
    expect(kinds(seen)).toEqual([MESSAGE_KIND.SNAPSHOT]);
    expect(bodies(seen)[0].jobs).toEqual([]);
  });

  it('follows partial reports: progress when the percent moves, nothing for temperatures, the finish as arrival and finished', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    expect(report(codec, partial({ nozzle_temper: 249.8, wifi_signal: '-45dBm' }))).toEqual([]);
    const moved = report(codec, partial({ mc_percent: 60, mc_remaining_time: 26 }));
    expect(kinds(moved)).toEqual(['job:progress']);
    expect(bodies(moved)[0]).toMatchObject({ percent: 60, remainingSec: 1560 });
    const done = report(codec, partial({ gcode_state: 'FINISH', mc_percent: 100, mc_remaining_time: 0 }));
    valid(done);
    expect(kinds(done)).toEqual(['job:arrived', 'job:finished']);
    expect(bodies(done)[1]).toMatchObject({ result: 'ok', jobId: 'lt-print-0001-p1s-01', unitId: 'U-0001' });
    expect(report(codec, partial({ gcode_state: 'IDLE' }))).toEqual([]);
  });

  it('reads a failed print as the job withdrawn', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    const failed = report(codec, partial({ gcode_state: 'FAILED' }));
    expect(kinds(failed)).toEqual(['job:withdrawn']);
    valid(failed);
  });

  it('raises a print error as a critical alarm with its meaning, and clears it under the same raise', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    const raised = report(codec, partial({ gcode_state: 'PAUSE', print_error: 134184977 }));
    valid(raised);
    expect(raised[0].parsed).toMatchObject({ kind: MESSAGE_KIND.ALARM, key: 'print-error' });
    expect(bodies(raised)[0]).toMatchObject({ code: '07FF-8011', level: 'critical', active: true, jobId: 'lt-print-0001-p1s-01' });
    expect(bodies(raised)[0].text).toMatch(/ran out of filament/);
    const cleared = report(codec, partial({ gcode_state: 'RUNNING', print_error: 0 }));
    expect(bodies(cleared)[0]).toMatchObject({ code: '07FF-8011', active: false, raisedAt: bodies(raised)[0].raisedAt });
  });

  it('reads acknowledgements as replies under the request\'s id, refused with the printer\'s code', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const ok = report(codec, accepted('project_file', 'row-1:dispatch'));
    expect(ok[0].parsed?.kind).toBe(MESSAGE_KIND.REPLY);
    expect(bodies(ok)[0]).toEqual({ cmdId: 'row-1:dispatch', status: REPLY_STATUS.ACCEPTED, reason: '' });
    expect(bodies(report(codec, refused('row-2:dispatch')))[0]).toEqual({ cmdId: 'row-2:dispatch', status: REPLY_STATUS.REFUSED, reason: '0502-4007' });
    expect(bodies(report(codec, systemAck('row-3:command')))[0]).toMatchObject({ cmdId: 'row-3:command', status: REPLY_STATUS.ACCEPTED });
  });

  it('answers a replayed message with the same messages, and only once changes state', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    const msg = partial({ gcode_state: 'FINISH' });
    const first = report(codec, msg);
    expect(report(codec, msg)).toBe(first);
    expect(report(codec, partial({ gcode_state: 'FINISH' }))).toEqual([]);
  });
});

describe('bambu codec: encode', () => {
  const dispatch = (args: Record<string, unknown>) => ({ cmdId: 'row-1:dispatch', op: OP.DISPATCH, args });
  const unit = { unitId: 'U-0001', carrierId: null, artifact: { url: 'http://files.local/part.gcode.3mf', sha256: 'ab' } };

  it('sends a dispatch as project_file on the printer\'s request topic, named for the job and unit', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    const [wire] = codec.encode(ident, dispatch({ jobId: 'lt-print-0001-p1s-01', units: [unit] }));
    expect(wire.topic).toBe(`${prefix}/request`);
    expect(JSON.parse(wire.payload).print).toMatchObject({
      sequence_id: 'row-1:dispatch', command: 'project_file', url: unit.artifact.url, subtask_name: SUBTASK,
      param: 'Metadata/plate_1.gcode', use_ams: false, bed_levelling: true,
    });
  });

  it('sends nothing for a dispatch without a file, or a command the printer has no request for', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    expect(codec.encode(ident, dispatch({ jobId: 'J', units: [{ unitId: 'U' }] }))).toEqual([]);
    expect(codec.encode(ident, { cmdId: 'c', op: OP.CHANGEOVER, args: {} })).toEqual([]);
    expect(codec.encode(ident, { cmdId: 'c', op: OP.STOP, args: {} })).toEqual([]);
  });

  it('pauses and resumes, and cancels only the print the printer is running', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    report(codec, fullReport());
    expect(JSON.parse(codec.encode(ident, { cmdId: 'c1', op: OP.PAUSE, args: {} })[0].payload).print).toMatchObject({ command: 'pause', sequence_id: 'c1' });
    expect(JSON.parse(codec.encode(ident, { cmdId: 'c2', op: OP.RESUME, args: {} })[0].payload).print).toMatchObject({ command: 'resume' });
    expect(codec.encode(ident, { cmdId: 'c3', op: OP.CANCEL, args: { jobId: 'another-job' } })).toEqual([]);
    expect(JSON.parse(codec.encode(ident, { cmdId: 'c4', op: OP.CANCEL, args: { jobId: 'lt-print-0001-p1s-01' } })[0].payload).print).toMatchObject({ command: 'stop' });
  });

  it('asks for a snapshot with pushall, and the next full report answers it', () => {
    const codec = bambuCodec({ root: ROOT, line: LINE });
    expect(codec.snapshotOnStart).toBe(true);
    const [ask] = codec.encode(ident, { cmdId: 'p1s-01:takeover:1', op: OP.SNAPSHOT, args: {} });
    expect(JSON.parse(ask.payload)).toEqual({ pushing: { sequence_id: 'p1s-01:takeover:1', command: 'pushall' } });
    const seen = report(codec, fullReport());
    expect(seen.at(-1)?.parsed?.kind).toBe(MESSAGE_KIND.REPLY);
    expect(bodies(seen).at(-1)).toMatchObject({ cmdId: 'p1s-01:takeover:1', status: REPLY_STATUS.ACCEPTED });
  });

  it('builds from the line for MACHINE_CODEC_MODULE, on the configured root', () => {
    const codec = createCodec(LINE);
    expect(codec.root).toBe(process.env.MACHINE_TOPIC_ROOT || ROOT);
    expect(codec.channels).toEqual({ events: ['report', 'bridge'], telemetry: [], commands: ['request'] });
    expect(CHANNEL.JOB).toBe('job');
    expect(JOB_EVENT.STARTED).toBe('started');
  });
});
