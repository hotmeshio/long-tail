import { describe, it, expect } from 'vitest';

import { normalizeScanCodeText } from '../ScanPanel';

describe('normalizeScanCodeText', () => {
  it('leaves a clean code untouched', () => {
    expect(normalizeScanCodeText('10:4:SN-TEST-8')).toBe('10:4:SN-TEST-8');
  });

  it('restores hyphens from en/em dashes and minus signs', () => {
    expect(normalizeScanCodeText('10:4:SN–TEST—8')).toBe('10:4:SN-TEST-8');
    expect(normalizeScanCodeText('10:4:SN−TEST−8')).toBe('10:4:SN-TEST-8');
  });

  it('drops control characters, including embedded CR/LF', () => {
    expect(normalizeScanCodeText('10\n:4:SN-TEST-8\r')).toBe('10:4:SN-TEST-8');
  });

  it('drops zero-width characters and the BOM', () => {
    expect(normalizeScanCodeText('﻿10:4:​SN-TEST-8‍')).toBe('10:4:SN-TEST-8');
  });

  it('straightens curly quotes and trims non-breaking space', () => {
    expect(normalizeScanCodeText(' 10:4:sn’s-8 ')).toBe("10:4:sn's-8");
  });
});
