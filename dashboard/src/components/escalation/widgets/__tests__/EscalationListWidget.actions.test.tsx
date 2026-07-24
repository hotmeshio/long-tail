import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EscalationListWidget } from '../EscalationListWidget';

const mockUseEscalations = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  useEscalations: (...args: unknown[]) => mockUseEscalations(...args),
  useResolveEscalation: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('../../../../lib/x-lt-help', () => ({
  interpolateHelp: (template: string, ctx: Record<string, unknown>) =>
    template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_: string, domain: string, key: string) => {
      const d = ctx[domain] as Record<string, string> | undefined;
      return d?.[key] ?? '—';
    }),
}));

vi.mock('../EscalationListView', () => ({
  rowContext: (esc: Record<string, unknown>) => ({
    escalation: esc,
    metadata: esc.metadata ?? {},
    envelope: {},
    payload: {},
    resolver: {},
  }),
}));

function makeEsc(id: string) {
  return {
    id,
    type: 'harvest',
    description: `Plate ${id}`,
    status: 'pending',
    priority: 2,
    role: 'harvester',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    envelope: '{}',
    metadata: { orderId: id, side: 'LEFT' },
    escalation_payload: null,
    resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: null,
    assigned_to: null, assigned_until: null, resolved_at: null,
    claimed_at: null, trace_id: null, span_id: null,
  };
}

const BAGGED_ACTION = {
  label: 'Bagged',
  resolverPayload: { approved: true, checks: { bagged: true }, orderId: '{{metadata.orderId}}' },
};

function renderWidget(schema: Record<string, unknown>) {
  return render(
    <MemoryRouter>
      <EscalationListWidget
        fieldKey="walk"
        value=""
        onChange={vi.fn()}
        schema={schema}
      />
    </MemoryRouter>,
  );
}

describe('EscalationListWidget — x-lt-actions', () => {
  beforeEach(() => {
    mockUseEscalations.mockReset();
    mockMutateAsync.mockReset();
    mockUseEscalations.mockReturnValue({
      data: { escalations: [makeEsc('ORD-1')], total: 1 },
      isLoading: false,
    });
    mockMutateAsync.mockResolvedValue({});
  });

  it('renders no action buttons when x-lt-actions is absent', () => {
    renderWidget({ title: 'Walk', 'x-lt-query': { role: 'harvester' } });
    expect(screen.queryByTestId('escalation-list-action-ORD-1')).not.toBeInTheDocument();
  });

  it('fires the resolve with the row-interpolated payload', async () => {
    renderWidget({
      title: 'Walk',
      'x-lt-query': { role: 'harvester' },
      'x-lt-actions': [BAGGED_ACTION],
    });
    fireEvent.click(screen.getByTestId('escalation-list-action-ORD-1'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const call = mockMutateAsync.mock.calls[0][0];
    expect(call.id).toBe('ORD-1');
    // string leaf interpolated per row; booleans stayed typed
    expect(call.resolverPayload).toEqual({
      approved: true,
      checks: { bagged: true },
      orderId: 'ORD-1',
    });
  });

  it('gates on confirm — declined confirm never fires', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWidget({
      title: 'Walk',
      'x-lt-query': { role: 'harvester' },
      'x-lt-actions': [{ ...BAGGED_ACTION, confirm: 'Bag {{metadata.orderId}}?' }],
    });
    fireEvent.click(screen.getByTestId('escalation-list-action-ORD-1'));
    expect(confirmSpy).toHaveBeenCalledWith('Bag ORD-1?');
    expect(mockMutateAsync).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('accepted confirm fires the resolve', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWidget({
      title: 'Walk',
      'x-lt-query': { role: 'harvester' },
      'x-lt-actions': [{ ...BAGGED_ACTION, confirm: 'Bag it?' }],
    });
    fireEvent.click(screen.getByTestId('escalation-list-action-ORD-1'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it('surfaces a rejected resolve inline and keeps the detail link', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Validation failed: checks.labeled is required'));
    renderWidget({
      title: 'Walk',
      'x-lt-query': { role: 'harvester' },
      'x-lt-actions': [BAGGED_ACTION],
    });
    fireEvent.click(screen.getByTestId('escalation-list-action-ORD-1'));
    const error = await screen.findByTestId('escalation-list-action-error-ORD-1');
    expect(error).toHaveTextContent('Validation failed: checks.labeled is required');
    // the full-form path stays available for the reject/complex case
    expect(screen.getByTitle('Open escalation detail')).toHaveAttribute(
      'href',
      '/escalations/detail/ORD-1',
    );
  });

  it('disables the button while the resolve is in flight', async () => {
    let release: () => void;
    mockMutateAsync.mockImplementation(
      () => new Promise<void>((res) => { release = res; }),
    );
    renderWidget({
      title: 'Walk',
      'x-lt-query': { role: 'harvester' },
      'x-lt-actions': [BAGGED_ACTION],
    });
    const button = screen.getByTestId('escalation-list-action-ORD-1');
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    release!();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
