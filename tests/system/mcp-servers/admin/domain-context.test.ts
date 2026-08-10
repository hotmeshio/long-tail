import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DomainDictionary } from '../../../../types';

// MCP wiring only — dictionary + registries are mocked.
let dictionary: DomainDictionary | null = null;
const mockRoles = vi.fn();
const mockConfigs = vi.fn();

vi.mock('../../../../services/domain', () => ({
  getDomainDictionary: vi.fn(async () => (dictionary ? { doc: dictionary, version: 1, updated_at: 'now' } : null)),
  getDomainIndex: vi.fn(async () => (dictionary ? { name: dictionary.name, terms: {}, runbooks: [] } : null)),
}));
vi.mock('../../../../services/role', () => ({
  listRolesWithDetails: (...a: unknown[]) => mockRoles(...a),
}));
vi.mock('../../../../services/config', () => ({
  listWorkflowConfigs: (...a: unknown[]) => mockConfigs(...a),
}));
vi.mock('../../../../services/escalation/queries', () => ({
  listFacetKeys: vi.fn(async () => ['serialNumber', 'orderId', 'facility']),
}));

import { registerDomainContextTools } from '../../../../system/mcp-servers/admin/domain-context';

function captureTool() {
  let handler: ((args: any) => Promise<any>) | null = null;
  registerDomainContextTools({
    registerTool(_name: string, _def: unknown, h: (args: any) => Promise<any>) {
      handler = h;
    },
  } as any);
  return handler!;
}

const parse = (result: any) => JSON.parse(result.content[0].text);

const DICT: DomainDictionary = {
  name: 'acme farm',
  version: '1',
  overview: 'prints things',
  terms: [
    { term: 'printer', aliases: ['machine'], kind: 'entity', maps_to: { roles: ['printer-fleet'] }, guidance: 'a machine' },
    { term: 'reset', kind: 'action', maps_to: { verb: 'cancel', role: 'print-operator' }, guidance: 'cancel the demand row' },
    { term: 'the pipe', kind: 'workflow', maps_to: { workflow: 'orderPipeline' }, kill_road: 'terminate the root', guidance: 'one per order' },
  ],
  runbooks: [{ name: 'kill a test order', steps: ['terminate the pipe root'] }],
};

let tool: (args: any) => Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  dictionary = DICT;
  mockRoles.mockResolvedValue([
    { role: 'printer-fleet', title: 'Printer Fleet', description: null, entity_facet: 'serialNumber', properties: { on_cancel: 'send the machine home' } },
    { role: 'print-operator', title: 'Print Operator', description: null, entity_facet: 'orderId', properties: {} },
  ]);
  mockConfigs.mockResolvedValue([
    { workflow_type: 'orderPipeline', description: 'makes an order', invocable: true, task_queue: 'factory' },
  ]);
  tool = captureTool();
});

describe('get_domain_context — registry-derived fallback (no dictionary)', () => {
  beforeEach(() => {
    dictionary = null;
  });

  it('no args serves a derived index from the live registries', async () => {
    const out = parse(await tool({}));
    expect(out.derived).toBe(true);
    expect(out.note).toMatch(/derived from the live registries/);
    expect(out.terms.role).toEqual(['printer-fleet', 'print-operator']);
    expect(out.terms.entity).toEqual(['serialNumber', 'orderId']);
    expect(out.terms.workflow).toEqual(['orderPipeline']);
    expect(out.terms.facet).toContain('facility');
    expect(out.runbooks).toEqual([]);
  });

  it('role lookup serves live rows incl. properties verb semantics', async () => {
    const [entry] = parse(await tool({ topic: 'role', name: 'printer-fleet' }));
    expect(entry).toMatchObject({
      kind: 'role', term: 'printer-fleet', derived: true,
      title: 'Printer Fleet', entity_facet: 'serialNumber', on_cancel: 'send the machine home',
    });
  });

  it('entity lookup derives systems from roles sharing an entity_facet', async () => {
    const [entry] = parse(await tool({ topic: 'entity', name: 'serialNumber' }));
    expect(entry).toMatchObject({ kind: 'entity', idFacet: 'serialNumber', roles: ['printer-fleet'] });
    expect(entry.guidance).toContain('facets={serialNumber: value}');
  });

  it('workflow lookup serves the live config with the stop road', async () => {
    const [entry] = parse(await tool({ topic: 'workflow', name: 'orderPipeline' }));
    expect(entry).toMatchObject({ kind: 'workflow', invocable: true });
    expect(entry.stop_note).toContain('terminate_workflow');
  });

  it('authored-only topics explain that they require a dictionary', async () => {
    const out = parse(await tool({ topic: 'runbook' }));
    expect(out.error).toMatch(/authored in the dictionary/);
    expect(out.hint).toMatch(/domainDictionaryPath|PUT \/api\/domain/);
  });
});

describe('get_domain_context', () => {

  it('no args returns the index', async () => {
    const out = parse(await tool({}));
    expect(out.name).toBe('acme farm');
  });

  it('entity lookup derives the id facet and joins live role semantics', async () => {
    const [entry] = parse(await tool({ topic: 'entity', name: 'printer' }));
    expect(entry.idFacet).toBe('serialNumber');
    expect(entry.live_roles[0]).toMatchObject({
      role: 'printer-fleet',
      title: 'Printer Fleet',
      entity_facet: 'serialNumber',
      on_cancel: 'send the machine home',
    });
  });

  it('term lookup matches aliases case-insensitively across kinds', async () => {
    const [entry] = parse(await tool({ topic: 'term', name: '  MACHINE ' }));
    expect(entry.term).toBe('printer');
  });

  it('workflow lookup joins the live config and states the stop road', async () => {
    const [entry] = parse(await tool({ topic: 'workflow', name: 'the pipe' }));
    expect(entry.kill_road).toBe('terminate the root');
    expect(entry.live_workflow).toMatchObject({ workflow_type: 'orderPipeline', invocable: true });
    expect(entry.stop_note).toContain('terminate_workflow');
  });

  it('annotates dangling references instead of throwing', async () => {
    mockRoles.mockResolvedValue([]);
    mockConfigs.mockResolvedValue([]);
    const [entity] = parse(await tool({ topic: 'entity', name: 'printer' }));
    expect(entity.live_roles[0]).toEqual({ role: 'printer-fleet', dangling: 'no longer a live role' });
    const [wf] = parse(await tool({ topic: 'workflow', name: 'the pipe' }));
    expect(wf.live_workflow.dangling).toMatch(/not a registered workflow/);
  });

  it('runbook topic returns steps; a miss returns a hint, never a throw', async () => {
    const runbooks = parse(await tool({ topic: 'runbook', name: 'Kill a Test Order' }));
    expect(runbooks[0].steps).toEqual(['terminate the pipe root']);
    const miss = parse(await tool({ topic: 'entity', name: 'unicorn' }));
    expect(miss.error).toMatch(/No dictionary entry/);
    expect(miss.hint).toBeDefined();
  });
});
