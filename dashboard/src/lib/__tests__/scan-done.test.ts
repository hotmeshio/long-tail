import { describe, it, expect } from 'vitest';
import { readScanDone, resolveScanDoneReturn, scanDonePath } from '../scan-done';

describe('readScanDone', () => {
  it('reads a route or home with an optional pause', () => {
    expect(readScanDone({ scan_done: { return: '/escalations/available?role=a', after_seconds: 3 } }))
      .toEqual({ return: '/escalations/available?role=a', after_seconds: 3 });
    expect(readScanDone({ scan_done: { return: 'home' } })).toEqual({ return: 'home' });
  });

  it('trusts nothing that does not check out', () => {
    expect(readScanDone(undefined)).toBeNull();
    expect(readScanDone({ scan_done: { return: 'https://elsewhere' } })).toBeNull();
    expect(readScanDone({ scan_done: { return: 'home', after_seconds: -1 } })).toEqual({ return: 'home' });
  });
});

describe('scanDonePath', () => {
  it('home resolves to the home path given', () => {
    expect(scanDonePath({ return: 'home' }, '/portal/a')).toBe('/portal/a');
    expect(scanDonePath({ return: 'home' }, null)).toBeNull();
  });
});

describe('resolveScanDoneReturn', () => {
  const chosen = { policy: { return: 'home' as const, after_seconds: 1 }, homePath: '/escalations/available?role=chosen' };
  const completed = { policy: { return: 'home' as const }, homePath: '/portal/done-role/main' };

  it('a chosen queue with its own policy wins', () => {
    expect(resolveScanDoneReturn(chosen, completed)).toEqual({ path: '/escalations/available?role=chosen', afterMs: 1000 });
  });

  it('with no chosen policy the completed row\'s role decides, at the default pause', () => {
    expect(resolveScanDoneReturn({ policy: null, homePath: null }, completed)).toEqual({ path: '/portal/done-role/main', afterMs: 2000 });
  });

  it('an act\'s own pause wins over the policy\'s, and the policy\'s button rides along', () => {
    const withButton = { policy: { return: 'home' as const, after_seconds: 1, button: 'Done' }, homePath: '/home' };
    expect(resolveScanDoneReturn(withButton, null, 5)).toEqual({ path: '/home', afterMs: 5000, button: 'Done' });
    expect(resolveScanDoneReturn(withButton, null, 0)).toEqual({ path: '/home', afterMs: 0, button: 'Done' });
    expect(readScanDone({ scan_done: { return: 'home', button: 'Done' } })).toEqual({ return: 'home', button: 'Done' });
    expect(readScanDone({ scan_done: { return: 'home', button: ' ' } })).toEqual({ return: 'home' });
  });

  it('no policy anywhere is no return', () => {
    expect(resolveScanDoneReturn({ policy: null, homePath: null }, null)).toBeNull();
    expect(resolveScanDoneReturn({ policy: null, homePath: null }, { policy: null, homePath: '/x' })).toBeNull();
  });
});
