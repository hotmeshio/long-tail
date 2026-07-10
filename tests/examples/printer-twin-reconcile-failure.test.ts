import { describe, it, expect } from 'vitest';

import { reconcile } from '../../examples/workflows/printer-twin/reconcile';
import { NOW, poll, obs, resolved, readyMirror, FILAMENT_RUNOUT_HMS, FAULT_HMS } from '../helpers/twin-fixtures';

const JOB = { jobId: 'j1', orderId: 'o1', unitIndex: 0, gcodeUrl: 'x', callbackKey: 'cb-1', reportedOutcome: null as null | string, startedAt: NOW };
const printing = (over = {}) =>
  readyMirror({ phase: 'printing', gcodeState: 'RUNNING', activeJob: { ...JOB }, ...over });

describe('reconcile — autonomous failure', () => {
  it('FAILED (not our stop) reports fail and opens a failure_inspect escalation', () => {
    const { mirror, actions } = reconcile(printing(), obs({ poll: poll('FAILED', { hms: FAULT_HMS }) }));
    expect(mirror.phase).toBe('failed_inspect');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'reportBroker', outcome: 'fail' }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'createEscalation', kind: 'failure_inspect' }));
  });

  it('failure_inspect resolved with reset issues bed_clean → needs_reset', () => {
    const m = printing({ phase: 'failed_inspect', gcodeState: 'FAILED', openEscalations: { failure_inspect: 'fi-1' } });
    const { mirror, actions } = reconcile(m, obs({ poll: poll('FAILED'), escalations: { 'fi-1': resolved({ action: 'reset' }) } }));
    expect(mirror.phase).toBe('needs_reset');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'issueCommand', command: 'bed_clean' }));
  });

  it('failure_inspect resolved with decommission retires the machine', () => {
    const m = printing({ phase: 'failed_inspect', gcodeState: 'FAILED', openEscalations: { failure_inspect: 'fi-1' } });
    const { mirror } = reconcile(m, obs({ poll: poll('FAILED'), escalations: { 'fi-1': resolved({ action: 'decommission' }) } }));
    expect(mirror.phase).toBe('retiring');
  });
});

describe('reconcile — filament runout (poll-only distinction)', () => {
  it('PAUSE + filament HMS opens a filament_change on the print-servicer role', () => {
    const { mirror, actions } = reconcile(printing(), obs({ poll: poll('PAUSE', { hms: FILAMENT_RUNOUT_HMS }) }));
    expect(mirror.phase).toBe('paused_filament');
    expect(mirror.hmsClass).toBe('filament');
    const fc = actions.find((a) => a.type === 'createEscalation' && a.kind === 'filament_change') as any;
    expect(fc?.spec.role).toBe('print-servicer');
  });

  it('PAUSE without a filament HMS is an operator pause — no filament_change', () => {
    const { mirror, actions } = reconcile(printing(), obs({ poll: poll('PAUSE', { hms: FAULT_HMS }) }));
    expect(mirror.phase).toBe('paused_operator');
    expect(actions.find((a) => a.type === 'createEscalation' && a.kind === 'filament_change')).toBeUndefined();
  });

  it('filament_change resolved updates the loaded filament and resumes', () => {
    const m = printing({ phase: 'paused_filament', gcodeState: 'PAUSE', openEscalations: { filament_change: 'fc-1' } });
    const { mirror, actions } = reconcile(m, obs({ poll: poll('PAUSE', { hms: FILAMENT_RUNOUT_HMS }), escalations: { 'fc-1': resolved({ filamentLoaded: 'petg' }) } }));
    expect(mirror.filamentLoaded).toBe('petg');
    expect(mirror.registration?.filament).toBe('petg');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'issueCommand', command: 'resume' }));
  });
});

describe('reconcile — offline (poll-only, no webhook)', () => {
  it('does not flip offline on a single online=false poll (debounce)', () => {
    const { mirror } = reconcile(printing(), obs({ poll: poll('RUNNING', { online: false }) }));
    expect(mirror.phase).toBe('printing');
    expect(mirror.consecutiveOfflinePolls).toBe(1);
  });

  it('crosses to offline after the strike threshold and holds the broker report', () => {
    const m = printing({ consecutiveOfflinePolls: 1 });
    const { mirror, actions } = reconcile(m, obs({ poll: poll('RUNNING', { online: false }) }));
    expect(mirror.phase).toBe('offline');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'createEscalation', kind: 'offline_investigate' }));
    expect(actions.find((a) => a.type === 'reportBroker')).toBeUndefined(); // job may survive — hold
  });

  it('returning online mid-print (RUNNING) resumes without a broker report', () => {
    const m = printing({ phase: 'offline', activeJob: { ...JOB }, openEscalations: { offline_investigate: 'off-1' } });
    const { mirror, actions } = reconcile(m, obs({ poll: poll('RUNNING'), escalations: { 'off-1': { status: 'pending' } } }));
    expect(mirror.phase).toBe('printing');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'resolveEscalation', kind: 'offline_investigate' }));
    expect(actions.find((a) => a.type === 'reportBroker')).toBeUndefined();
  });

  it('returning online IDLE with a lost job reports cancel and goes ready', () => {
    const m = printing({ phase: 'offline', gcodeState: 'RUNNING', activeJob: { ...JOB } });
    const { mirror, actions } = reconcile(m, obs({ poll: poll('IDLE') }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'reportBroker', outcome: 'cancel' }));
    expect(mirror.phase).toBe('ready');
    expect(mirror.activeJob).toBeNull();
  });

  it('give-up: still offline past the threshold reports cancel to free the order', () => {
    const m = printing({ phase: 'offline', activeJob: { ...JOB }, phaseEnteredAt: NOW - 700_000 });
    const { actions } = reconcile(m, obs({ poll: poll('RUNNING', { online: false }) }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'reportBroker', outcome: 'cancel' }));
  });
});

describe('reconcile — poll resilience', () => {
  it('a transport failure is NOT offline — phase and counters are retained', () => {
    const m = printing();
    const { mirror } = reconcile(m, obs({ poll: { ok: false, error: 'transport', message: 'ETIMEDOUT' } }));
    expect(mirror.phase).toBe('printing');
    expect(mirror.online).toBe(true); // unchanged — never forced false by a bad poll
    expect(mirror.consecutivePollFailures).toBe(1);
  });
});
