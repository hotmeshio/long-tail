import { describe, it, expect } from 'vitest';
import type { DomainDictionary } from '../../../../types';
import { validateDictionary, type RegistrySnapshot } from '../../../../services/domain/validate';

const registry: RegistrySnapshot = {
  roles: [
    { role: 'printer-fleet', entity_facet: 'serialNumber' },
    { role: 'print-operator', entity_facet: 'orderId' },
  ],
  workflowTypes: ['orderPipeline'],
  facetKeys: ['serialNumber', 'orderId', 'facility'],
};

const dictionary: DomainDictionary = {
  name: 'test farm',
  version: '1',
  overview: 'a test deployment',
  terms: [
    { term: 'printer', aliases: ['machine'], kind: 'entity', maps_to: { roles: ['printer-fleet'] }, guidance: 'a machine' },
    { term: 'order', kind: 'entity', maps_to: { role: 'print-operator' }, guidance: 'a job', idFacet: 'po' },
    { term: 'reset', kind: 'action', maps_to: { verb: 'cancel', role: 'print-operator' }, guidance: 'cancel the demand row' },
    { term: 'the pipe', kind: 'workflow', maps_to: { workflow: 'orderPipeline' }, kill_road: 'terminate the root', guidance: 'one per order' },
    { term: 'plant', kind: 'facet', maps_to: { facet: 'facility' }, guidance: 'which building' },
  ],
  runbooks: [{ name: 'kill a test order', steps: ['terminate the pipe root'] }],
};

describe('validateDictionary', () => {
  it('accepts a valid dictionary with no errors or warnings', () => {
    const { errors, warnings } = validateDictionary(dictionary, registry);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('derives an entity idFacet from its role entity_facet; declared idFacet wins', () => {
    const { dictionary: derived } = validateDictionary(dictionary, registry);
    expect(derived.terms?.find((t) => t.term === 'printer')?.idFacet).toBe('serialNumber');
    expect(derived.terms?.find((t) => t.term === 'order')?.idFacet).toBe('po');
  });

  it('errors on an unknown role (hard registry)', () => {
    const bad = { ...dictionary, terms: [{ term: 'x', kind: 'role' as const, maps_to: { role: 'ghost' }, guidance: 'g' }] };
    const { errors } = validateDictionary(bad, registry);
    expect(errors.some((e) => e.includes('"ghost"') && e.includes('not a live role'))).toBe(true);
  });

  it('errors on an unknown workflow (hard registry)', () => {
    const bad = { ...dictionary, terms: [{ term: 'x', kind: 'workflow' as const, maps_to: { workflow: 'ghostFlow' }, guidance: 'g' }] };
    const { errors } = validateDictionary(bad, registry);
    expect(errors.some((e) => e.includes('"ghostFlow"'))).toBe(true);
  });

  it('warns (never errors) on an unknown facet — facets are data-derived', () => {
    const soft = { ...dictionary, terms: [{ term: 'x', kind: 'facet' as const, maps_to: { facet: 'notyet' }, guidance: 'g' }] };
    const { errors, warnings } = validateDictionary(soft, registry);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('"notyet"'))).toBe(true);
  });

  it('errors on an unknown term kind and a missing name/overview', () => {
    const bad = {
      name: '', version: '1', overview: '',
      terms: [{ term: 'x', kind: 'vibe' as any, guidance: 'g' }],
    } as DomainDictionary;
    const { errors } = validateDictionary(bad, registry);
    expect(errors.some((e) => e.includes('name and overview'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown kind "vibe"'))).toBe(true);
  });

  it('warns when an entity has no idFacet and none is derivable', () => {
    const soft = { ...dictionary, terms: [{ term: 'thing', kind: 'entity' as const, guidance: 'g' }] };
    const { warnings } = validateDictionary(soft, registry);
    expect(warnings.some((w) => w.includes('no idFacet'))).toBe(true);
  });
});
