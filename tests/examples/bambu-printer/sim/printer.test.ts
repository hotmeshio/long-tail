import { afterEach, describe, expect, it } from 'vitest';
import { SimPrinter } from '../../../../examples/workflows/bambu-printer/sim/printer';

const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('simulated printer', () => {
  let sent: Record<string, any>[];
  let printer: SimPrinter;
  const make = (opts = { steps: 4, tickMs: 10 }) => {
    sent = [];
    printer = new SimPrinter({ report: (body) => sent.push(body) }, opts);
    return printer;
  };
  const prints = () => sent.map((m) => m.print);
  const start = (seq = '7', name = 'R1-p1s-01~U-1') => printer.receive({ print: { command: 'project_file', sequence_id: seq, subtask_name: name, url: 'file:///sdcard/cache/R1.gcode.3mf' } });

  afterEach(() => printer?.stop());

  it('answers pushall with a full report of its state', () => {
    make().receive({ pushing: { command: 'pushall', sequence_id: '1' } });
    expect(prints()[0]).toMatchObject({ command: 'push_status', gcode_state: 'IDLE', nozzle_diameter: '0.8' });
    expect(printer.requests).toHaveLength(1);
  });

  it('acks project_file, names the job first, then runs it to FINISH', async () => {
    make();
    start();
    expect(prints()[0]).toMatchObject({ command: 'project_file', sequence_id: '7', result: 'success' });
    expect(prints()[1]).toEqual(expect.objectContaining({ subtask_name: 'R1-p1s-01~U-1' }));
    expect(prints()[1].gcode_state).toBeUndefined();
    await until(() => printer.state.gcode_state === 'FINISH');
    expect(printer.state).toMatchObject({ mc_percent: 100, layer_num: 4, total_layer_num: 4 });
  });

  it('refuses a print while busy, with the busy error code', () => {
    make().occupy();
    start('8');
    expect(prints().at(-1)).toEqual({ sequence_id: '8', command: 'project_file', param: '', err_code: 84033544 });
    printer.vacate();
    expect(printer.state.gcode_state).toBe('IDLE');
  });

  it('pauses on a runout with 07FF-8011 and resumes at the printer', () => {
    make().runOut();
    expect(printer.state).toMatchObject({ gcode_state: 'PAUSE', print_error: 134184977 });
    printer.resumeAtPrinter();
    expect(printer.state).toMatchObject({ gcode_state: 'RUNNING', print_error: 0 });
  });

  it('obeys pause, resume and stop with an ack each', () => {
    make();
    start();
    for (const [command, state] of [['pause', 'PAUSE'], ['resume', 'RUNNING'], ['stop', 'FAILED']]) {
      printer.receive({ print: { command, sequence_id: command } });
      expect(prints().find((p) => p.sequence_id === command)).toMatchObject({ command, result: 'success' });
      expect(printer.state.gcode_state).toBe(state);
    }
  });

  it('holds progress at a percent until released', async () => {
    make({ steps: 4, tickMs: 5 }).hold(50);
    start();
    await until(() => printer.state.mc_percent === 50);
    await new Promise((r) => setTimeout(r, 40));
    expect(printer.state.mc_percent).toBe(50);
    printer.release();
    await until(() => printer.state.gcode_state === 'FINISH');
  });

  it('reports minutes left from the tick length', () => {
    make({ steps: 60, tickMs: 1_000 });
    start();
    expect(prints()[2]).toMatchObject({ gcode_state: 'RUNNING', mc_remaining_time: 1, total_layer_num: 60 });
  });
});
