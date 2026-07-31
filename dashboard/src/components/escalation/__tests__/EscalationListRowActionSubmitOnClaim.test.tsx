import { render as rtlRender, screen, fireEvent, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationListView } from '../EscalationListView';
import type { LTEscalationRecord } from '../../../api/types';

const render = (ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...options });

const mockMutate = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined, isLoading: false }),
  useClaimEscalation: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
}));

function makeRow(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'e1',
    type: 'harvest',
    subtype: 'start',
    description: 'Start the harvest',
    status: 'pending',
    priority: 2,
    task_id: null, origin_id: null, parent_id: null, workflow_id: 'wf1', task_queue: null,
    workflow_type: 'harvest', role: 'harvester',
    assigned_to: null, assigned_until: null, resolved_at: null, claimed_at: null,
    envelope: null,
    metadata: { title: 'Field A' },
    escalation_payload: null,
    resolver_payload: null,
    created_at: '2026-07-14T00:00:00.000Z',
    updated_at: '2026-07-14T00:00:00.000Z',
    trace_id: null, span_id: null,
    ...overrides,
  } as LTEscalationRecord;
}

const SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [{ label: 'Title', value: '{{metadata.title}}' }],
  'x-lt-row-action': { label: 'Start Harvesting', durationMinutes: 60, submitOnClaim: true },
};

describe('x-lt-row-action submitOnClaim', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockNavigate.mockReset();
  });

  it('launches the detail auto-start flow with the intent, not an inline claim', () => {
    render(
      <EscalationListView role="harvester" listSchema={SCHEMA} activeEscalations={[makeRow()]} />,
    );
    const button = screen.getByTestId('row-action-button');
    expect(button).toHaveTextContent('Start Harvesting');

    fireEvent.click(button);

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/escalations/detail/e1',
      expect.objectContaining({
        state: expect.objectContaining({ autoStart: true, durationMinutes: 60 }),
      }),
    );
  });

  it('still hides the button on rows under a live claim window', () => {
    render(
      <EscalationListView
        role="harvester"
        listSchema={SCHEMA}
        activeEscalations={[makeRow({ assigned_to: 'someone', assigned_until: new Date(Date.now() + 60_000).toISOString() })]}
      />,
    );
    expect(screen.queryByTestId('row-action-button')).not.toBeInTheDocument();
  });
});
