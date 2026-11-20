import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { NatsLTEvent } from '../nats/types';
import {
  affectedEscalationQueries,
  escalationChangeOf,
  type EscalationChange,
} from '../escalation-refresh';

const ID = '0f2c1d3e-1111-4222-8333-444455556666';
const OTHER_ID = '9a8b7c6d-1111-4222-8333-444455556666';

let qc: QueryClient;

function seed(key: unknown[], data: unknown = { escalations: [], total: 0 }) {
  qc.setQueryDefaults(key, { gcTime: Infinity });
  qc.setQueryData(key, data);
}

function change(overrides: Partial<EscalationChange> = {}): EscalationChange {
  return {
    id: ID, verb: 'created', roles: ['gluer'], assignedTo: null, reassignedFrom: null,
    workflowId: 'wf-1', facets: null, ...overrides,
  };
}

function affected(c: EscalationChange) {
  return affectedEscalationQueries(qc, c).map((a) => [a.tier, a.queryKey]);
}

beforeEach(() => {
  qc = new QueryClient();
});

describe('escalationChangeOf', () => {
  it('reads ids, roles, assignee and facets from the event', () => {
    const event = {
      type: 'system.escalation.gluer.e1.reassigned',
      escalationId: 'e1',
      workflowId: 'wf-9',
      role: 'Gluer Bench',
      data: { assigned_to: 'u1', from_role: 'gluer', to_role: 'finisher', metadata: { po: 'A' } },
    } as unknown as NatsLTEvent;
    expect(escalationChangeOf(event)).toEqual({
      id: 'e1', verb: 'reassigned', roles: ['Gluer Bench', 'gluer', 'finisher'],
      assignedTo: 'u1', reassignedFrom: null, workflowId: 'wf-9', facets: { po: 'A' },
    });
  });

  it('falls back to the subject tokens when the payload is thin', () => {
    const change = escalationChangeOf({ type: 'system.escalation.gluer.e2.claimed' } as unknown as NatsLTEvent);
    expect(change).toMatchObject({ id: 'e2', verb: 'claimed', roles: ['gluer'], facets: null });
  });
});

describe('list queries', () => {
  it('skips a list whose role filter excludes every queue the change touches', () => {
    seed(['escalations', { role: 'packing' }]);
    seed(['escalations', 'available', { roles: ['packing'] }]);
    expect(affected(change())).toEqual([]);
  });

  it('refreshes a list whose role matches, from either end of a move', () => {
    seed(['escalations', 'available', { role: 'finisher' }]);
    expect(affected(change({ verb: 'reassigned', roles: ['gluer', 'finisher'] }))).toEqual([
      ['LIST', ['escalations', 'available', { role: 'finisher' }]],
    ]);
  });

  it('matches roles through the subject-token spelling', () => {
    seed(['escalations', { role: 'Gluer Bench' }]);
    expect(affected(change({ roles: ['Gluer-Bench'] }))).toHaveLength(1);
  });

  it('always refreshes a list that holds the row, whatever its filters say', () => {
    seed(['escalations', { role: 'packing' }], { escalations: [{ id: ID }], total: 1 });
    expect(affected(change())).toHaveLength(1);
  });

  it('skips an assignee list the row never touched, but not a release', () => {
    seed(['escalations', { assigned_to: 'u1', status: 'pending' }]);
    expect(affected(change({ verb: 'claimed', assignedTo: 'u2' }))).toEqual([]);
    expect(affected(change({ verb: 'claimed', assignedTo: 'u1' }))).toHaveLength(1);
    expect(affected(change({ verb: 'reassigned', assignedTo: 'u2', reassignedFrom: 'u1' }))).toHaveLength(1);
    expect(affected(change({ verb: 'released', assignedTo: null }))).toHaveLength(1);
  });

  it('refreshes an assignee list when the event does not name the assignee', () => {
    seed(['escalations', { assigned_to: 'u1' }]);
    expect(affected(change({ assignedTo: null }))).toHaveLength(1);
  });

  it('skips a facet-filtered list when the row carries different facets', () => {
    seed(['escalations', 'available', { facets: { po: 'A' }, status: 'all' }]);
    expect(affected(change({ facets: { po: 'B' } }))).toEqual([]);
    expect(affected(change({ facets: { po: 'A' } }))).toHaveLength(1);
  });

  it('an update may have changed facets, so it refreshes facet-filtered lists', () => {
    seed(['escalations', { facets: { po: 'A' } }]);
    expect(affected(change({ verb: 'updated', facets: { po: 'B' } }))).toHaveLength(1);
  });

  it('refreshes facet-filtered lists when the facets are unknown or not comparable', () => {
    seed(['escalations', { facets: { po: 'A' } }]);
    seed(['escalations', { facets: { po: { prefix: 'A' } } }]);
    expect(affected(change({ facets: null }))).toHaveLength(2);
    expect(affected(change({ facets: { po: 'B' } }))).toHaveLength(1);
  });

  it('puts counts on SUMMARY and other lists on LIST', () => {
    seed(['escalations', 'available', { limit: 1 }]);
    seed(['escalations', { limit: 50 }]);
    expect(affected(change())).toEqual([
      ['SUMMARY', ['escalations', 'available', { limit: 1 }]],
      ['LIST', ['escalations', { limit: 50 }]],
    ]);
  });
});

describe('record and relation queries', () => {
  it('refreshes a record only for its own events', () => {
    seed(['escalations', ID]);
    seed(['escalations', ID, 'lookups']);
    seed(['escalations', OTHER_ID]);
    expect(affected(change())).toEqual([
      ['DETAIL', ['escalations', ID]],
      ['DETAIL', ['escalations', ID, 'lookups']],
    ]);
  });

  it('refreshes by-workflow reads for that workflow only', () => {
    seed(['escalations', 'by-workflow', 'wf-1']);
    seed(['escalations', 'by-workflow', 'wf-2']);
    expect(affected(change())).toEqual([['DETAIL', ['escalations', 'by-workflow', 'wf-1']]]);
  });

  it('refreshes related reads for the queues they read', () => {
    seed(['escalations', 'related', 'gluer', 'latest', [ID]]);
    seed(['escalations', 'related-rows', 'packing', 'latest', ID, 'set', null]);
    expect(affected(change())).toEqual([['LIST', ['escalations', 'related', 'gluer', 'latest', [ID]]]]);
  });

  it('ignores queries outside the escalations family', () => {
    seed(['jobs']);
    expect(affected(change())).toEqual([]);
  });
});
