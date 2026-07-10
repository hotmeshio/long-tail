import { describe, it, expect, beforeEach } from 'vitest';

import { mockBackend, mockControl } from '../../examples/workflows/printer-twin/activities/bambu-mock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fast print timing so the wall-clock ticker resolves in tens of ms.
beforeEach(() => {
  process.env.MOCK_PREPARE_MS = '5';
  process.env.MOCK_PRINT_MS = '30';
  mockControl.reset();
});

async function state(sn: string): Promise<string> {
  const r = await mockBackend.pollDevice(sn);
  return r.ok ? r.snapshot.reportStatus.gcode_state : `err:${r.error}`;
}

describe('bambu-mock — binding + poll', () => {
  it('an unbound serial polls as unbound (not an error, not offline)', async () => {
    expect(await state('S1')).toBe('err:unbound');
  });

  it('bind brings it online and IDLE', async () => {
    await mockBackend.bind('S1', 'C12');
    const r = await mockBackend.pollDevice('S1');
    expect(r.ok && r.snapshot.online).toBe(true);
    expect(await state('S1')).toBe('IDLE');
  });
});

describe('bambu-mock — print lifecycle', () => {
  it('runs PREPARE → RUNNING → FINISH by default', async () => {
    await mockBackend.bind('S1');
    await mockBackend.uploadAndPrint('S1', { jobId: 'j1' } as any);
    expect(await state('S1')).toBe('PREPARE');
    await sleep(15);
    expect(await state('S1')).toBe('RUNNING');
    await sleep(35);
    expect(await state('S1')).toBe('FINISH');
    await mockBackend.opt('S1', 'bed_clean');
    expect(await state('S1')).toBe('IDLE');
  });

  it('armed failed ends FAILED; armed filament_runout ends PAUSE with a filament HMS', async () => {
    await mockBackend.bind('SF');
    await mockBackend.uploadAndPrint('SF', { jobId: 'jf', simOutcome: 'failed' } as any);
    await sleep(45);
    expect(await state('SF')).toBe('FAILED');

    await mockBackend.bind('SR');
    await mockBackend.uploadAndPrint('SR', { jobId: 'jr', simOutcome: 'filament_runout' } as any);
    await sleep(45);
    const r = await mockBackend.pollDevice('SR');
    expect(r.ok && r.snapshot.reportStatus.gcode_state).toBe('PAUSE');
    expect(r.ok && r.snapshot.reportStatus.hms.length).toBeGreaterThan(0);
  });

  it('resume after a filament pause runs to a successful FINISH', async () => {
    await mockBackend.bind('SR');
    await mockBackend.uploadAndPrint('SR', { jobId: 'jr', simOutcome: 'filament_runout' } as any);
    await sleep(45);
    expect(await state('SR')).toBe('PAUSE');
    await mockBackend.opt('SR', 'resume');
    await sleep(45);
    expect(await state('SR')).toBe('FINISH');
  });

  it('stop flips to FAILED with no event (poll-only confirmation)', async () => {
    await mockBackend.bind('S1');
    await mockBackend.uploadAndPrint('S1', { jobId: 'j1' } as any);
    await sleep(15);
    await mockBackend.opt('S1', 'stop');
    expect(await state('S1')).toBe('FAILED');
  });
});

describe('bambu-mock — offline (silent)', () => {
  it('power-cycle goes offline then silently returns online', async () => {
    await mockBackend.bind('S1');
    mockControl.powerCycle('S1', 20);
    const off = await mockBackend.pollDevice('S1');
    expect(off.ok && off.snapshot.online).toBe(false);
    await sleep(30);
    const on = await mockBackend.pollDevice('S1');
    expect(on.ok && on.snapshot.online).toBe(true);
  });
});
