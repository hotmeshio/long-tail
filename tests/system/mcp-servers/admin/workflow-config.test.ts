import { describe, it, expect, vi, beforeEach } from 'vitest';

// MCP wiring only; every dependency is mocked.
const mockGetWorkflowConfig = vi.fn();
const mockUpsertWorkflowConfig = vi.fn();
const mockResolveLookupContext = vi.fn();
const mockRestartCron = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('../../../../services/config', () => ({
  listWorkflowConfigs: vi.fn().mockResolvedValue([]),
  getWorkflowConfig: (...a: unknown[]) => mockGetWorkflowConfig(...a),
  upsertWorkflowConfig: (...a: unknown[]) => mockUpsertWorkflowConfig(...a),
  deleteWorkflowConfig: vi.fn(),
}));
vi.mock('../../../../services/knowledge/lookup-cache', () => ({
  resolveLookupContext: (...a: unknown[]) => mockResolveLookupContext(...a),
}));
const mockMissingRefs = vi.fn();
vi.mock('../../../../services/knowledge/lookup-refs', () => ({
  describeMissingLookupRefs: (...a: unknown[]) => mockMissingRefs(...a),
}));
vi.mock('../../../../services/cron', () => ({
  cronRegistry: { restartCron: (...a: unknown[]) => mockRestartCron(...a) },
}));
vi.mock('../../../../modules/ltconfig', () => ({
  ltConfig: { invalidate: (...a: unknown[]) => mockInvalidate(...a) },
}));

import { registerWorkflowConfigTools } from '../../../../system/mcp-servers/admin/workflow-config';
import { upsertWorkflowConfigSchema } from '../../../../system/mcp-servers/admin/schemas';

function captureTools() {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  registerWorkflowConfigTools({
    registerTool(name: string, _def: unknown, handler: (args: any) => Promise<any>) {
      handlers.set(name, handler);
    },
  } as any);
  return handlers;
}

const parse = (result: any) => JSON.parse(result.content[0].text);

const REFS = [{ domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' }];
const ROW = {
  workflow_type: 'fleetTools', invocable: true, certified: false, task_queue: 'q', default_role: 'reviewer',
  description: null, roles: [], invocation_roles: [], consumes: [], tool_tags: [],
  envelope_schema: { metadata: { source: 'dashboard' } }, input_schema: { properties: {} },
  input_lookups: REFS, icon: null, resolver_schema: null, cron_schedule: null, execute_as: null, read_safe: false,
};

let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLookupContext.mockResolvedValue(null);
  mockMissingRefs.mockResolvedValue([]);
  mockUpsertWorkflowConfig.mockImplementation(async (c: any) => c);
  tools = captureTools();
});

describe('admin workflow config MCP tools', () => {
  it('registers get_workflow_config beside list/upsert/delete', () => {
    for (const name of ['list_workflow_configs', 'get_workflow_config', 'upsert_workflow_config', 'delete_workflow_config']) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it('get_workflow_config returns the full row with tier and resolved lookup data', async () => {
    mockGetWorkflowConfig.mockResolvedValue(ROW);
    mockResolveLookupContext.mockResolvedValue({ serials: { items: [{ value: 'sn-1', label: 'Printer 1' }] } });
    const result = await tools.get('get_workflow_config')!({ workflow_type: 'fleetTools' });
    expect(parse(result)).toEqual({
      ...ROW,
      tier: 'registered',
      input_lookup_data: { serials: { items: [{ value: 'sn-1', label: 'Printer 1' }] } },
    });
    expect(mockResolveLookupContext).toHaveBeenCalledWith(REFS);
  });

  it('get_workflow_config reports certified as the tier and null lookup data when none are pinned', async () => {
    mockGetWorkflowConfig.mockResolvedValue({ ...ROW, certified: true, input_lookups: null });
    const result = await tools.get('get_workflow_config')!({ workflow_type: 'fleetTools' });
    expect(parse(result)).toMatchObject({ tier: 'certified', input_lookup_data: null });
  });

  it('get_workflow_config is an error for an unregistered workflow', async () => {
    mockGetWorkflowConfig.mockResolvedValue(null);
    const result = await tools.get('get_workflow_config')!({ workflow_type: 'ghost' });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe('Workflow config not found');
  });

  it('upsert_workflow_config passes input_schema, input_lookups, icon, and read_safe through', async () => {
    const args = upsertWorkflowConfigSchema.parse({
      workflow_type: 'fleetTools', invocable: true,
      input_schema: { properties: { serialNumber: { type: 'string' } } },
      input_lookups: REFS, icon: 'Wrench', read_safe: true,
    });
    await tools.get('upsert_workflow_config')!(args);
    expect(mockUpsertWorkflowConfig).toHaveBeenCalledWith(expect.objectContaining({
      workflow_type: 'fleetTools',
      input_schema: { properties: { serialNumber: { type: 'string' } } },
      input_lookups: REFS,
      icon: 'Wrench',
      read_safe: true,
    }));
    expect(mockInvalidate).toHaveBeenCalled();
    expect(mockRestartCron).toHaveBeenCalled();
  });

  it('upsert_workflow_config clears omitted fields, matching PUT', async () => {
    const args = upsertWorkflowConfigSchema.parse({ workflow_type: 'fleetTools' });
    await tools.get('upsert_workflow_config')!(args);
    expect(mockUpsertWorkflowConfig).toHaveBeenCalledWith(expect.objectContaining({
      input_schema: null, input_lookups: null, icon: null, read_safe: false, invocable: false,
    }));
  });

  it('upsert_workflow_config refuses malformed lookup refs before writing', async () => {
    const result = await tools.get('upsert_workflow_config')!({
      ...upsertWorkflowConfigSchema.parse({ workflow_type: 'fleetTools' }),
      input_lookups: [{ domain: 'fleet', key: 'serial-numbers' }],
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toMatch(/positive integer version/);
    expect(mockUpsertWorkflowConfig).not.toHaveBeenCalled();
  });

  it('upsert_workflow_config refuses a pin with no edition behind it, naming what exists', async () => {
    mockMissingRefs.mockResolvedValue(['Lookup ref fleet/serial-numbers v9 names no edition (editions: v1)']);
    const result = await tools.get('upsert_workflow_config')!({
      ...upsertWorkflowConfigSchema.parse({ workflow_type: 'fleetTools' }),
      input_lookups: [{ ...REFS[0], version: 9 }],
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe('Lookup ref fleet/serial-numbers v9 names no edition (editions: v1)');
    expect(mockUpsertWorkflowConfig).not.toHaveBeenCalled();
  });

  it('upsert_workflow_config refuses an unknown icon before writing', async () => {
    const result = await tools.get('upsert_workflow_config')!({
      ...upsertWorkflowConfigSchema.parse({ workflow_type: 'fleetTools' }),
      icon: 'not-an-icon',
    });
    expect(result.isError).toBe(true);
    expect(mockUpsertWorkflowConfig).not.toHaveBeenCalled();
  });
});
