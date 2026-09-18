import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InvocableWorkflow } from '../../../../api/types';
import { invocable, RICH_SCHEMA } from '../../../../pages/workflows/start/__tests__/invoke-test-data';

const mutateAsync = vi.fn();
let invocableList: { data: InvocableWorkflow[] | undefined; isPending: boolean } = { data: [], isPending: false };
let patterns: string[] = [];
let handler: ((event: unknown) => void) | null = null;

vi.mock('../../../../api/workflows', () => ({
  useInvocableWorkflows: () => invocableList,
  useInvokeWorkflow: () => ({ mutateAsync, isPending: false, reset: vi.fn() }),
  useWorkflowLookups: () => ({ data: undefined }),
  foldWorkflowLookups: () => ({}),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (p: string[], h: (event: unknown) => void) => { if (p.length) { patterns = p; handler = h; } },
  useEventStatus: () => ({ connected: true }),
}));

import { InvokeWidget } from '../InvokeWidget';

const PAMPHLET = invocable({
  workflow_type: 'printPamphlet',
  certified: true,
  icon: 'Printer',
  envelope_schema: { data: {}, metadata: { source: 'dashboard' } },
});
const TOOLS = invocable({ workflow_type: 'fleetTools', input_schema: RICH_SCHEMA, icon: 'Wrench' });

const CONTEXT = {
  escalation: { id: 'esc-1', status: 'pending', role: 'qc-inspector' },
  metadata: { orderId: 'ORD-1', copies: 2, serial: 'sn-1' },
  envelope: {},
  payload: {},
  resolver: {},
};

function renderWidget(schema: Record<string, unknown>, context: Record<string, unknown> = CONTEXT) {
  return render(
    <MemoryRouter>
      <InvokeWidget fieldKey="print" value="" onChange={vi.fn()} schema={schema} escalationContext={context} />
    </MemoryRouter>,
  );
}

const DIRECT = {
  title: 'Print pamphlet',
  description: 'Prints the pamphlet for this order',
  'x-lt-invoke': {
    workflow: 'printPamphlet',
    data: { order: { id: '{{metadata.orderId}}' }, copies: '{{metadata.copies}}', missing: '{{metadata.nope}}' },
    metadata: { escalationId: '{{escalation.id}}' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  patterns = [];
  handler = null;
  invocableList = { data: [PAMPHLET, TOOLS], isPending: false };
  mutateAsync.mockResolvedValue({ workflowId: 'wf-1', message: 'Workflow started' });
});

describe('InvokeWidget', () => {
  it('renders the field title, helper, and the workflow icon on the control', () => {
    renderWidget(DIRECT);
    const control = screen.getByTestId('invoke-control-print');
    expect(control).toHaveTextContent('Print pamphlet');
    expect(control.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Prints the pamphlet for this order')).toBeInTheDocument();
  });

  it('labels the control from the workflow type when the field has no title', () => {
    renderWidget({ 'x-lt-invoke': { workflow: 'printPamphlet', icon: false } });
    const control = screen.getByTestId('invoke-control-print');
    expect(control).toHaveTextContent('Print Pamphlet');
    expect(control.querySelector('svg')).toBeNull();
  });

  it('renders nothing for a workflow the caller may not invoke', () => {
    invocableList = { data: [TOOLS], isPending: false };
    renderWidget(DIRECT);
    expect(screen.queryByTestId('invoke-widget-print')).not.toBeInTheDocument();
  });

  it('renders nothing once the escalation is no longer pending', () => {
    renderWidget(DIRECT, { ...CONTEXT, escalation: { ...CONTEXT.escalation, status: 'resolved' } });
    expect(screen.queryByTestId('invoke-widget-print')).not.toBeInTheDocument();
  });

  it('holds a placeholder while the invocable list loads', () => {
    invocableList = { data: undefined, isPending: true };
    renderWidget(DIRECT);
    expect(screen.getByTestId('invoke-widget-print-loading')).toBeInTheDocument();
  });

  it('direct mode posts the mapped payload with typed values and the run metadata', async () => {
    renderWidget(DIRECT);
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith({
      workflowType: 'printPamphlet',
      data: { order: { id: 'ORD-1' }, copies: 2 },
      metadata: { source: 'dashboard', escalationId: 'esc-1', certified: true },
    });
    await waitFor(() => expect(screen.getByTestId('run-outcome')).toHaveTextContent('Working…'));
    expect(patterns).toEqual(['lt.events.system.workflow.wf-1.completed', 'lt.events.system.workflow.wf-1.failed']);
    expect(screen.queryByTestId('invoke-control-print')).not.toBeInTheDocument();
  });

  it('a settled run reads as an outline and re-arms the control beneath it', async () => {
    renderWidget(DIRECT);
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    await waitFor(() => expect(screen.getByTestId('run-outcome')).toBeInTheDocument());
    act(() => handler!({ type: 'system.workflow.wf-1.completed', workflowId: 'wf-1', data: { printed: true, pages: 2 } }));
    expect(screen.getByTestId('run-outcome')).toHaveTextContent('Completed');
    expect(screen.getByTestId('run-outline')).toHaveTextContent('pages');
    expect(screen.getByTestId('run-outline').textContent).not.toContain('{');
    expect(screen.getByTestId('invoke-control-print')).toHaveTextContent('Print pamphlet');
    expect(screen.queryByText('Run again')).not.toBeInTheDocument();
  });

  it('a failed run shows the reason and re-arms the control', async () => {
    renderWidget(DIRECT);
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    await waitFor(() => expect(screen.getByTestId('run-outcome')).toBeInTheDocument());
    act(() => handler!({ type: 'system.workflow.wf-1.failed', workflowId: 'wf-1', data: { error: 'Printer offline' } }));
    expect(screen.getByTestId('run-outcome')).toHaveTextContent('Failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Printer offline');
    expect(screen.queryByTestId('run-outline')).not.toBeInTheDocument();
    expect(screen.getByTestId('invoke-control-print')).toBeInTheDocument();
  });

  it('a confirm prompt interpolates the context and gates the post', async () => {
    renderWidget({ ...DIRECT, 'x-lt-invoke': { ...DIRECT['x-lt-invoke'], confirm: 'Print for {{metadata.orderId}}?' } });
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Print for ORD-1?');
    fireEvent.click(screen.getByTestId('invoke-confirm-print'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
  });

  it('a payload the input schema refuses lists the issues and offers the form instead of posting', () => {
    renderWidget({
      title: 'Fleet tools',
      'x-lt-invoke': { workflow: 'fleetTools', data: { printer: { serialNumber: '{{metadata.serial}}' } } },
    });
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('invoke-issues-print')).toHaveTextContent('action');
    fireEvent.click(screen.getByTestId('invoke-open-form-print'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Serial/)).toHaveValue('sn-1');
  });

  it('modal mode opens the workflow form prefilled from the mapping', () => {
    renderWidget({
      title: 'Fleet tools',
      'x-lt-invoke': { workflow: 'fleetTools', modal: true, data: { printer: { serialNumber: '{{metadata.serial}}' } } },
    });
    fireEvent.click(screen.getByTestId('invoke-control-print'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Fleet Tools');
    expect(screen.getByLabelText(/Serial/)).toHaveValue('sn-1');
    expect(screen.getByTestId('invoke-start')).toBeInTheDocument();
  });
});
