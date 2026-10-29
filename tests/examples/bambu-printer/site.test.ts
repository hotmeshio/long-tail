import { describe, expect, it } from 'vitest';
import { BAMBU_ROLES, bambuLine, printersFromEnv } from '../../../examples/workflows/bambu-printer/env';
import { renderPrinterBridges } from '../../../examples/workflows/bambu-printer/site/bridge';

const ENV = {
  BAMBU_SITE_ID: 'site-1', BAMBU_LINE_ID: 'print-1', BAMBU_PRINTERS: 'p1s-01, h2s-01',
  BAMBU_P1S_01_SERIAL: '01P00A000000001', BAMBU_P1S_01_HOST: '10.0.0.21', BAMBU_P1S_01_CODE: 'code-one', BAMBU_P1S_01_ENABLED: 'true',
  BAMBU_H2S_01_SERIAL: '0938A0000000002', BAMBU_H2S_01_HOST: '10.0.0.22', BAMBU_H2S_01_CODE: 'code-two', BAMBU_H2S_01_ENABLED: 'false',
};

describe('bambu printers from the environment', () => {
  it('reads each listed printer, and puts only enabled ones on the line', () => {
    const printers = printersFromEnv(ENV);
    expect(printers.map((p) => [p.station, p.serial, p.enabled])).toEqual([['p1s-01', '01P00A000000001', true], ['h2s-01', '0938A0000000002', false]]);
    const line = bambuLine(printers, ENV);
    expect(line).toMatchObject({ siteId: 'site-1', lineId: 'print-1', roles: { exit: BAMBU_ROLES.UNLOAD, operator: BAMBU_ROLES.SERVICING } });
    expect(line.machines.map((m) => [m.machineId, m.address, m.queueDepth, m.requireArtifact])).toEqual([['p1s-01', '01P00A000000001', 1, true]]);
  });

  it('fails loudly on a missing setting, a bad serial, or no enabled printer', () => {
    expect(() => printersFromEnv({})).toThrow(/BAMBU_PRINTERS/);
    expect(() => printersFromEnv({ ...ENV, BAMBU_P1S_01_CODE: '' })).toThrow(/BAMBU_P1S_01_CODE/);
    expect(() => printersFromEnv({ ...ENV, BAMBU_P1S_01_SERIAL: 'has.dot' })).toThrow(/topic level/);
    expect(() => bambuLine(printersFromEnv(ENV), { ...ENV, BAMBU_LINE_ID: '' })).toThrow(/BAMBU_LINE_ID/);
    expect(() => bambuLine(printersFromEnv({ ...ENV, BAMBU_P1S_01_ENABLED: 'false' }), ENV)).toThrow(/no printer is enabled/);
  });
});

describe('printer bridges', () => {
  it('bridges each printer on the line: its report in and requests out under its level, the bridge state kept locally', () => {
    const printers = printersFromEnv(ENV);
    const conf = renderPrinterBridges(bambuLine(printers, ENV), printers, { root: 'line/v1', certDir: '/certs' });
    expect(conf).toContain('connection site-1-print-1-p1s-01\naddress 10.0.0.21:8883\n');
    expect(conf).toContain('remote_username bblp\nremote_password code-one\n');
    expect(conf).toContain('bridge_cafile /certs/bambu-ca-01P00A000000001.pem\nbridge_insecure true\n');
    expect(conf).toContain('notifications true\nnotifications_local_only true\nnotification_topic line/v1/site-1/print-1/01P00A000000001/bridge\n');
    expect(conf).toContain('topic report in 0 line/v1/site-1/print-1/01P00A000000001/ device/01P00A000000001/\n');
    expect(conf).toContain('topic request out 0 line/v1/site-1/print-1/01P00A000000001/ device/01P00A000000001/\n');
    expect(conf).not.toContain('10.0.0.22');
  });
});
