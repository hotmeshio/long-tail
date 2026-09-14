import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EscalationFormSection } from '../EscalationDetailSections';
import type { LTEscalationRecord } from '../../../../api/types';

const schema = {
  'x-lt-viewport': {
    type: 'iframe',
    src: 'https://app.example.com/design?id={workbenchId}',
    onPending: 'https://app.example.com/preview?id={workbenchId}',
    onResolved: 'https://app.example.com/summary?stl={stl_url}',
  },
  properties: { stl_url: { type: 'string' } },
};

const bareSchema = { 'x-lt-viewport': { type: 'iframe', src: schema['x-lt-viewport'].src }, properties: {} };

function esc(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'esc-1', type: 'cad', subtype: 'design', description: 'Design', status: 'pending', priority: 2,
    role: 'cad-designer', workflow_type: 'design', task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, assigned_to: null, assigned_until: null, resolved_at: null,
    claimed_at: null, envelope: '{}', metadata: null,
    escalation_payload: JSON.stringify({ workbenchId: 'wb-7' }),
    resolver_payload: null, trace_id: null, span_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderSection(record: LTEscalationRecord, formSchema: Record<string, unknown>, opts: { editable?: boolean; onClaim?: () => void } = {}) {
  const isTerminal = record.status !== 'pending';
  return render(
    <MemoryRouter>
      <EscalationFormSection
        esc={record}
        resolverPayload={record.resolver_payload ? JSON.parse(record.resolver_payload) : null}
        isTerminal={isTerminal}
        editable={opts.editable ?? false}
        activeView="resolve"
        metadataFormSchema={null}
        effectiveSchema={formSchema}
        json="{}"
        onJsonChange={() => {}}
        requestTriage={false}
        onRequestTriageChange={() => {}}
        triageNotes=""
        onTriageNotesChange={() => {}}
        onResolve={vi.fn()}
        onEscalate={vi.fn()}
        onClaim={opts.onClaim}
      />
    </MemoryRouter>,
  );
}

const iframeSrc = () => (screen.getByTitle('HITL Viewport') as HTMLIFrameElement).src;

describe('EscalationFormSection — viewport stages', () => {
  it('pending and unclaimed: onPending renders read-only with tokens expanded', () => {
    renderSection(esc(), schema);
    expect(iframeSrc()).toBe('https://app.example.com/preview?id=wb-7');
    expect(screen.queryByText('Claim to launch the editor')).toBeNull();
  });

  it('pending and unclaimed without onPending: the claim affordance stands', () => {
    renderSection(esc(), bareSchema, { onClaim: vi.fn() });
    expect(screen.queryByTitle('HITL Viewport')).toBeNull();
    expect(screen.getByText('Claim to launch the editor')).toBeTruthy();
  });

  it('claimed: the editor src renders', () => {
    renderSection(esc({ assigned_to: 'me' }), schema, { editable: true });
    expect(iframeSrc()).toBe('https://app.example.com/design?id=wb-7');
  });

  it('resolved: onResolved renders with resolver payload tokens', () => {
    renderSection(esc({ status: 'resolved', resolver_payload: JSON.stringify({ stl_url: 's3://final.stl' }) }), schema);
    expect(iframeSrc()).toBe('https://app.example.com/summary?stl=s3://final.stl');
  });

  it('resolved without onResolved: the submitted values render instead', () => {
    renderSection(esc({ status: 'resolved', resolver_payload: JSON.stringify({ stl_url: 's3://final.stl' }) }), bareSchema);
    expect(screen.queryByTitle('HITL Viewport')).toBeNull();
  });

  it('cancelled: onResolved does not apply', () => {
    renderSection(esc({ status: 'cancelled' }), schema);
    expect(screen.queryByTitle('HITL Viewport')).toBeNull();
  });
});
