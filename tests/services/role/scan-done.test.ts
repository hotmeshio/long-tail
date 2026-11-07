import { describe, it, expect } from 'vitest';

import { scanDoneError, readScanDone } from '../../../services/role/scan-done';

describe('properties.scan_done', () => {
  it('accepts home or a dashboard route, with an optional pause', () => {
    expect(scanDoneError({ return: 'home' })).toBeNull();
    expect(scanDoneError({ return: 'home', after_seconds: 0 })).toBeNull();
    expect(scanDoneError({ return: '/escalations/available?role=binning', after_seconds: 5 })).toBeNull();
    expect(scanDoneError(undefined)).toBeNull();
  });

  it('accepts a button that returns at once', () => {
    expect(scanDoneError({ return: 'home', after_seconds: 5, button: 'Done' })).toBeNull();
    expect(scanDoneError({ return: 'home', button: ' ' })).toMatch(/button must be non-empty text/);
    expect(scanDoneError({ return: 'home', button: 3 })).toMatch(/button/);
  });

  it('names the problem', () => {
    expect(scanDoneError('home')).toMatch(/must be an object/);
    expect(scanDoneError({})).toMatch(/return must be/);
    expect(scanDoneError({ return: 'https://elsewhere' })).toMatch(/return must be/);
    expect(scanDoneError({ return: 'home', after_seconds: 61 })).toMatch(/after_seconds/);
    expect(scanDoneError({ return: 'home', after_seconds: 1.5 })).toMatch(/after_seconds/);
    expect(scanDoneError({ return: 'home', pause: 2 })).toMatch(/unknown key/);
  });

  it('reads a usable policy from the bag and ignores an unusable one', () => {
    expect(readScanDone({ kiosk: true, scan_done: { return: 'home', after_seconds: 3 } })).toEqual({ return: 'home', after_seconds: 3 });
    expect(readScanDone({ scan_done: { return: 'nowhere' } })).toBeNull();
    expect(readScanDone(null)).toBeNull();
  });
});
