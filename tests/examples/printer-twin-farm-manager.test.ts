import { describe, it, expect } from 'vitest';

import {
  resolveFarmManagerBackend,
  buildFarmManagerRequest,
} from '../../examples/workflows/printer-twin/activities/farm-manager';
import type { FarmManagerJob } from '../../examples/workflows/printer-twin/activities/farm-manager';

const JOB: FarmManagerJob = {
  serialNumber: 'SN-100',
  model: 'M-1',
  jobId: 'ORDER-1-u0-t3',
  orderId: 'ORDER-1',
  unitIndex: 0,
  gcodeUrl: 'https://example.com/unit-0.gcode',
  printDoneKey: 'print-done-ORDER-1-u0-t3',
};

describe('resolveFarmManagerBackend', () => {
  it('defaults to mock when unset', () => {
    expect(resolveFarmManagerBackend({})).toEqual({ backend: 'mock', baseUrl: '' });
  });

  it('http requires a base url — fail loud, never fall back to mock', () => {
    expect(() => resolveFarmManagerBackend({ FARM_MANAGER_BACKEND: 'http' }))
      .toThrow(/FARM_MANAGER_BASE_URL/);
  });

  it('an unknown backend throws — no silent fallback', () => {
    expect(() => resolveFarmManagerBackend({ FARM_MANAGER_BACKEND: 'carrier-pigeon' }))
      .toThrow(/unknown FARM_MANAGER_BACKEND/);
  });

  it('http with a base url resolves cleanly', () => {
    expect(resolveFarmManagerBackend({
      FARM_MANAGER_BACKEND: 'http',
      FARM_MANAGER_BASE_URL: 'http://farm-host:4000',
    })).toEqual({ backend: 'http', baseUrl: 'http://farm-host:4000' });
  });
});

describe('buildFarmManagerRequest', () => {
  it('targets the host print-jobs endpoint, trailing slash tolerated', () => {
    expect(buildFarmManagerRequest('http://farm-host:4000/', JOB).url)
      .toBe('http://farm-host:4000/print-jobs');
  });

  it('carries the gcode url and the machine identity', () => {
    const { body } = buildFarmManagerRequest('http://farm-host:4000', JOB);
    expect(body).toMatchObject({
      serialNumber: 'SN-100',
      jobId: 'ORDER-1-u0-t3',
      gcodeUrl: 'https://example.com/unit-0.gcode',
    });
  });

  it('the callback contract echoes the printing row signal key', () => {
    const { body } = buildFarmManagerRequest('http://farm-host:4000', JOB);
    expect(body.callback).toEqual({
      method: 'POST',
      path: '/api/escalations/resolve-by-signal-key',
      body: {
        signalKey: 'print-done-ORDER-1-u0-t3',
        resolverPayload: { outcome: 'success', reportedBy: 'farm-manager' },
      },
    });
  });
});
