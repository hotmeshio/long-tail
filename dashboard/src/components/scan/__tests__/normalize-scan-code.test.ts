import { describe, it, expect } from 'vitest';

import { normalizeScanCodeText } from '../ScanPanel';

describe('normalizeScanCodeText', () => {
  it('leaves a clean code untouched', () => {
    expect(normalizeScanCodeText('1:04:SN-TEST-8')).toBe('1:04:SN-TEST-8');
  });

  it('restores hyphens from en/em dashes and minus signs', () => {
    expect(normalizeScanCodeText('1:04:SN–TEST—8')).toBe('1:04:SN-TEST-8');
    expect(normalizeScanCodeText('1:04:SN−TEST−8')).toBe('1:04:SN-TEST-8');
  });

  it('drops control characters, including embedded CR/LF', () => {
    expect(normalizeScanCodeText('1\n:04:SN-TEST-8\r')).toBe('1:04:SN-TEST-8');
  });

  it('drops zero-width characters and the BOM', () => {
    expect(normalizeScanCodeText('﻿1:04:​SN-TEST-8‍')).toBe('1:04:SN-TEST-8');
  });

  it('straightens curly quotes and trims non-breaking space', () => {
    expect(normalizeScanCodeText(' 1:04:sn’s-8 ')).toBe("1:04:sn's-8");
  });
});
