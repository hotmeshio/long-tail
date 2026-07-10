import { describe, it, expect } from 'vitest';

import { reconcile } from '../../examples/workflows/printer-twin/reconcile';
import { freshMirror } from '../../examples/workflows/printer-twin/mirror';
import { NOW, REGISTRATION, poll, obs, resolved, readyMirror } from '../helpers/twin-fixtures';

// The happy-path lifecycle: onboarding → bind → ready → advert → print → finish → reset → ready.

describe('reconcile — onboarding', () => {
  it('a fresh twin opens a register escalation on the print-onboarder role (form is the role\'s)', () => {
    const { mirror, actions } = reconcile(freshMirror('printer-01', NOW), obs());
    expect(mirror.phase).toBe('onboarding');
    const reg = actions.find((a) => a.type === 'createEscalation' && a.kind === 'register') as any;
    expect(reg?.spec.role).toBe('print-onboarder');
    // The form is NOT inline on the escalation — it belongs to the role.
    expect(reg?.spec.formSchema).toBeUndefined();
    expect(reg?.spec.metadata.form_schema).toBeUndefined();
  });

  it('register resolved binds the machine and captures identity', () => {
    const m = freshMirror('printer-01', NOW);
    m.openEscalations.register = 'esc-reg';
    const { mirror, actions } = reconcile(m, obs({ escalations: { 'esc-reg': resolved(REGISTRATION as any) } }));
    expect(mirror.sn).toBe(REGISTRATION.serialNumber);
    expect(mirror.registration?.model).toBe('C12');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'issueCommand', command: 'bind' }));
    expect(mirror.pendingCommand?.expect).toBe('BOUND');
  });

  it('poll confirming bound advances onboarding → ready', () => {
    const m = freshMirror('printer-01', NOW);
    m.registration = REGISTRATION;
    m.sn = REGISTRATION.serialNumber;
    m.pendingCommand = { opt: 'bind', issuedAt: NOW, expect: 'BOUND', attempts: 1 };
    const { mirror } = reconcile(m, obs({ poll: poll('IDLE', { bound: true }) }));
    expect(mirror.bound).toBe(true);
    expect(mirror.pendingCommand).toBeNull();
    expect(mirror.phase).toBe('ready');
  });
});

describe('reconcile — ready + dispatch', () => {
  it('a ready twin advertises availability', () => {
    const { actions } = reconcile(readyMirror(), obs({ poll: poll('IDLE') }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'createEscalation', kind: 'ready' }));
  });

  it('the broker resolving the advert with a job starts a print', () => {
    const m = readyMirror({ openEscalations: { ready: 'adv-1' } });
    const job = { jobId: 'j1', orderId: 'o1', unitIndex: 0, gcodeUrl: 'x', callbackKey: 'cb-1', printDoneKey: 'pd-1', brokerWorkflowId: 'bk' };
    const { mirror, actions } = reconcile(m, obs({ poll: poll('IDLE'), escalations: { 'adv-1': resolved(job) } }));
    expect(mirror.phase).toBe('printing');
    expect(mirror.activeJob?.callbackKey).toBe('cb-1');
    expect(actions).toContainEqual(expect.objectContaining({ type: 'issueCommand', command: 'print' }));
  });

  it('does not advertise while a servicer escalation is open', () => {
    const m = readyMirror({ openEscalations: { service: 'svc-1' } });
    const { actions } = reconcile(m, obs({ poll: poll('IDLE'), escalations: { 'svc-1': { status: 'pending' } } }));
    expect(actions.find((a) => a.type === 'createEscalation' && a.kind === 'ready')).toBeUndefined();
  });
});

describe('reconcile — print completion → reset → ready', () => {
  const printing = () =>
    readyMirror({ phase: 'printing', gcodeState: 'RUNNING', activeJob: { jobId: 'j1', orderId: 'o1', unitIndex: 0, gcodeUrl: 'x', callbackKey: 'cb-1', reportedOutcome: null, startedAt: NOW } });

  it('FINISH reports success to the broker and issues bed_clean', () => {
    const { mirror, actions } = reconcile(printing(), obs({ poll: poll('FINISH') }));
    expect(mirror.phase).toBe('needs_reset');
    expect(mirror.jobsCompleted).toBe(1);
    expect(actions).toContainEqual(expect.objectContaining({ type: 'reportBroker', outcome: 'success' }));
    expect(actions).toContainEqual(expect.objectContaining({ type: 'issueCommand', command: 'bed_clean' }));
  });

  it('reports terminal exactly once — a second FINISH tick does not re-report', () => {
    const m = printing();
    m.activeJob!.reportedOutcome = 'success';
    m.phase = 'needs_reset';
    const { actions } = reconcile(m, obs({ poll: poll('FINISH') }));
    expect(actions.find((a) => a.type === 'reportBroker')).toBeUndefined();
  });

  it('bed_clean confirmed (poll IDLE) returns the twin to ready', () => {
    const m = readyMirror({ phase: 'needs_reset', gcodeState: 'FINISH', activeJob: { jobId: 'j1', orderId: 'o1', unitIndex: 0, gcodeUrl: 'x', callbackKey: 'cb-1', reportedOutcome: 'success', startedAt: NOW } });
    const { mirror } = reconcile(m, obs({ poll: poll('IDLE') }));
    expect(mirror.phase).toBe('ready');
    expect(mirror.activeJob).toBeNull();
  });
});
