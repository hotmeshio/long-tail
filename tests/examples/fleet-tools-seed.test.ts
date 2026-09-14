import { describe, it, expect, vi, beforeEach } from 'vitest';

// The fleet serial list is read from the escalation store on every boot and
// written as a knowledge edition; the pin on the worker config decides which
// edition the form reads.
const mockAggregate = vi.fn();
const mockStore = vi.fn();
const mockGet = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();

vi.mock('../../services/escalation', () => ({ aggregateByFacets: (...a: unknown[]) => mockAggregate(...a) }));
vi.mock('../../system/activities/knowledge', () => ({
  storeKnowledge: (...a: unknown[]) => mockStore(...a),
  getKnowledge: (...a: unknown[]) => mockGet(...a),
}));
vi.mock('../../lib/logger', () => ({ loggerRegistry: { info: (...a: unknown[]) => mockInfo(...a), warn: (...a: unknown[]) => mockWarn(...a) } }));

import { seedFleetToolsKnowledge, fleetSerialOptions } from '../../examples/seed-fleet-tools';
import { FLEET_SERIALS_LOOKUP, FLEET_MATERIALS_LOOKUP } from '../../examples/workflows/fleet-tools/forms';

const ROWS = [
  { facets: { serialNumber: 'PRN-004', facility: 'south' }, count: 3 },
  { facets: { serialNumber: 'PRN-001', facility: 'north' }, count: 5 },
  { facets: { serialNumber: 'PRN-001', facility: 'north' }, count: 1 },
  { facets: { serialNumber: null, facility: 'north' }, count: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ found: false });
  mockStore.mockResolvedValue({ current_version: 1 });
});

describe('fleetSerialOptions', () => {
  it('yields one labeled option per serial, sorted, skipping rows with no serial', () => {
    expect(fleetSerialOptions(ROWS)).toEqual([
      { value: 'PRN-001', label: 'PRN-001 (north)' },
      { value: 'PRN-004', label: 'PRN-004 (south)' },
    ]);
    expect(fleetSerialOptions([{ facets: { serialNumber: 'X-1', facility: null } }])).toEqual([{ value: 'X-1', label: 'X-1' }]);
  });
});

describe('seedFleetToolsKnowledge', () => {
  it('groups the store by serial and facility and writes the list as the serials edition', async () => {
    mockAggregate.mockResolvedValue({ groups: ROWS, overflow: false });
    await seedFleetToolsKnowledge();
    expect(mockAggregate).toHaveBeenCalledWith(expect.objectContaining({ groupBy: { facets: ['serialNumber', 'facility'] }, measure: { kind: 'membership' } }));
    expect(mockStore).toHaveBeenCalledWith(expect.objectContaining({
      domain: FLEET_SERIALS_LOOKUP.domain,
      key: FLEET_SERIALS_LOOKUP.key,
      data: { items: fleetSerialOptions(ROWS) },
    }));
    expect(mockStore).toHaveBeenCalledWith(expect.objectContaining({ domain: FLEET_MATERIALS_LOOKUP.domain, key: FLEET_MATERIALS_LOOKUP.key }));
  });

  it('writes nothing for the serials when the store holds none, and leaves an existing catalog alone', async () => {
    mockAggregate.mockResolvedValue({ groups: [], overflow: false });
    mockGet.mockResolvedValue({ found: true });
    await seedFleetToolsKnowledge();
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('reports a newer edition than the pinned one', async () => {
    mockAggregate.mockResolvedValue({ groups: ROWS, overflow: false });
    mockStore.mockResolvedValue({ current_version: FLEET_SERIALS_LOOKUP.version + 1 });
    await seedFleetToolsKnowledge();
    expect(mockInfo.mock.calls.some(([m]) => String(m).includes(`v${FLEET_SERIALS_LOOKUP.version + 1} is available to pin`))).toBe(true);
  });

  it('a failing query is logged and never throws', async () => {
    mockAggregate.mockRejectedValue(new Error('no pool'));
    await expect(seedFleetToolsKnowledge()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalled();
    expect(mockStore).not.toHaveBeenCalled();
  });
});
