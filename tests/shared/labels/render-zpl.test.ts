import { describe, it, expect } from 'vitest';

import { buildLabelSheet } from '../../../shared/labels/layout';
import { resolveMedia } from '../../../shared/labels/media';
import { renderSheetZpl, zplField, ZplRenderError } from '../../../shared/labels/render-zpl';
import type { LabelContent, LabelSymbology } from '../../../shared/labels/types';

const twoCode: LabelContent = {
  title: 'A-3',
  lines: ['Acme^North'],
  codes: [
    { code: '14:0:A-3', caption: 'Check in', tone: 'solid' },
    { code: '14:1:A-3', caption: 'Check out', tone: 'outline' },
  ],
};

const zpl = (symbology: LabelSymbology, labels = [twoCode], copies = 1) =>
  renderSheetZpl(buildLabelSheet({ media: resolveMedia('thermal-4x2'), labels, symbology, humanReadable: true, copies }));

describe('renderSheetZpl', () => {
  it('writes one label format per printed label, sized in dots', () => {
    const out = zpl('code128', [twoCode, twoCode], 2);
    expect(out.match(/\^XA/g)).toHaveLength(4);
    expect(out.match(/\^XZ/g)).toHaveLength(4);
    expect(out).toContain('^PW812');
    expect(out).toContain('^CI28');
  });

  it('reverses the caption over a solid band', () => {
    const out = zpl('code128');
    expect(out).toMatch(/\^FR\^FH\^FDCheck in\^FS/);
    expect(out).not.toMatch(/\^FR\^FH\^FDCheck out/);
  });

  it('uses the printer\'s own barcode for each symbology', () => {
    expect(zpl('code128')).toMatch(/\^BCN,\d+,N,N,N,A\^FH\^FD14:0:A-3\^FS/);
    expect(zpl('qrcode')).toMatch(/\^BQN,2,\d+\^FH\^FDMA,14:0:A-3\^FS/);
    expect(zpl('datamatrix')).toMatch(/\^BXN,\d+,200\^FH\^FD14:0:A-3\^FS/);
  });

  it('escapes ZPL command characters in field data', () => {
    expect(zpl('code128')).toContain('Acme_5ENorth');
    expect(zplField('a^b~c_d\\e')).toBe('a_5Eb_7Ec_5Fd_5Ce');
  });

  it('refuses sheet stock and masked labels', () => {
    const sheet = buildLabelSheet({ media: resolveMedia('a4-l7160'), labels: [twoCode], symbology: 'code128', humanReadable: true });
    expect(() => renderSheetZpl(sheet)).toThrow(ZplRenderError);
    expect(() => zpl('code128', [{ ...twoCode, masked: true }])).toThrow(/masked/);
  });
});
