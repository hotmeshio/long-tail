import { describe, it, expect, afterEach } from 'vitest';

import { configureDisplay, getDisplay, isValidTimeZone } from '../../../modules/display';
import { getSettings } from '../../../api/settings';

afterEach(() => configureDisplay(undefined));

describe('display time zone', () => {
  it('is unset by default, so dates render in the browser zone', () => {
    configureDisplay(undefined);
    expect(getDisplay()).toEqual({ timeZone: null });
  });

  it('accepts an IANA zone and serves it with the settings', async () => {
    configureDisplay({ timeZone: 'America/Chicago' });
    expect(getDisplay()).toEqual({ timeZone: 'America/Chicago' });
    const settings = await getSettings();
    expect(settings.data.display).toEqual({ timeZone: 'America/Chicago' });
  });

  it('fails the boot on a zone the runtime does not know', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => configureDisplay({ timeZone: 'Mars/Olympus' })).toThrow(/not an IANA time zone/);
    expect(() => configureDisplay({ timeZone: 5 as any })).toThrow(/not an IANA time zone/);
  });
});
