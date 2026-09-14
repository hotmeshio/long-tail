import { describe, it, expect, vi, beforeEach } from 'vitest';

// PUT /api/workflows/:type/config guards the lookup DSL twice: shape, then
// the existence of every pinned edition. Nothing is written on a refusal.
const mockUpsert = vi.fn();
const mockMissing = vi.fn();
vi.mock('../../services/config', () => ({ upsertWorkflowConfig: (...a: unknown[]) => mockUpsert(...a) }));
vi.mock('../../services/knowledge/lookup-refs', () => ({ describeMissingLookupRefs: (...a: unknown[]) => mockMissing(...a) }));
vi.mock('../../services/cron', () => ({ cronRegistry: { restartCron: vi.fn() }, validateCronSchedule: vi.fn() }));
vi.mock('../../modules/ltconfig', () => ({ ltConfig: { invalidate: vi.fn() } }));

import { upsertWorkflowConfig } from '../../api/workflows/config';

const REF = { domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' };

beforeEach(() => {
  vi.clearAllMocks();
  mockMissing.mockResolvedValue([]);
  mockUpsert.mockImplementation(async (c: unknown) => c);
});

describe('PUT workflow config with input_lookups', () => {
  it('refuses a malformed ref with the field named and writes nothing', async () => {
    const result = await upsertWorkflowConfig({ type: 'fleetTools', input_lookups: [{ domain: 'fleet', key: 'serial-numbers' } as any] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/positive integer version/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('refuses a pin with no edition behind it, naming the editions that exist', async () => {
    mockMissing.mockResolvedValue(['Lookup ref fleet/serial-numbers v3 names no edition (editions: v1)']);
    const result = await upsertWorkflowConfig({ type: 'fleetTools', input_lookups: [{ ...REF, version: 3 }] });
    expect(result.status).toBe(400);
    expect(result.error).toBe('Lookup ref fleet/serial-numbers v3 names no edition (editions: v1)');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('writes a well-formed pin whose edition exists', async () => {
    const result = await upsertWorkflowConfig({ type: 'fleetTools', input_lookups: [REF] });
    expect(result.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ input_lookups: [REF] }));
  });

  it('a config without lookups never touches the knowledge store', async () => {
    const result = await upsertWorkflowConfig({ type: 'basicEcho' });
    expect(result.status).toBe(200);
    expect(mockMissing).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ input_lookups: null }));
  });
});
