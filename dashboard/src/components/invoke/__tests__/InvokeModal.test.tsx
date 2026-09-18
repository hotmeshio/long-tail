import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { invocable, REVIEW, TOOLS } from '../../../pages/workflows/start/__tests__/invoke-test-data';

const mutateAsync = vi.fn();
let handler: ((event: unknown) => void) | null = null;
vi.mock('../../../api/workflows', () => ({
  useInvokeWorkflow: () => ({ mutateAsync, isPending: false, reset: vi.fn() }),
  useWorkflowLookups: () => ({ data: undefined }),
  foldWorkflowLookups: () => ({}),
}));
vi.mock('../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (p: string[], h: (event: unknown) => void) => { if (p.length) handler = h; },
  useEventStatus: () => ({ connected: true }),
}));

import { InvokeModal } from '../InvokeModal';

const event = (action: 'completed' | 'failed', data?: Record<string, unknown>) => ({
  type: `system.workflow.wf-1.${action}`, workflowId: 'wf-1', workflowName: 'fleetTools', taskQueue: 'q', source: 'interceptor', timestamp: '2026-01-01T00:00:00Z', data,
});

async function submitRetire() {
  fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'retire' } });
  fireEvent.click(screen.getByTestId('invoke-start'));
  await waitFor(() => expect(screen.getByTestId('run-receipt')).toBeInTheDocument());
}

function renderModal(props: Partial<Parameters<typeof InvokeModal>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter>
      <InvokeModal open workflow={TOOLS} prefill={{ data: { printer: { serialNumber: 'sn-1' } }, metadata: {} }} onClose={onClose} {...props} />
    </MemoryRouter>,
  );
  return { ...view, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  handler = null;
  mutateAsync.mockResolvedValue({ workflowId: 'wf-1', message: 'Workflow started' });
});

describe('InvokeModal', () => {
  it('heads the dialog with the workflow title and prefills the bound field', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toHaveTextContent('Fleet Tools');
    expect(screen.getByLabelText(/Serial/)).toHaveValue('sn-1');
  });

  it('submits the form values mapped back into the nested payload with the run metadata', async () => {
    renderModal({ prefill: { data: { printer: { serialNumber: 'sn-1' } }, metadata: { escalationId: 'esc-1' } } });
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'retire' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith({
      workflowType: 'fleetTools',
      // Hidden conditional fields submit their defaults, as on every x-lt-* form.
      data: { printer: { serialNumber: 'sn-1' }, tool: { action: 'retire' }, copies: 1, reprintTips: '### Reprint tips' },
      metadata: { source: 'dashboard', escalationId: 'esc-1' },
    });
  });

  it('lists issues inline beneath the fields when the form does not validate', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('invoke-inline-issues')).toHaveTextContent('Action');
  });

  it('a workflow without an input schema gets the template form prefilled', () => {
    renderModal({ workflow: REVIEW, prefill: { data: { message: 'hi there' }, metadata: {} } });
    expect(screen.getByDisplayValue('hi there')).toBeInTheDocument();
  });

  it('a certified workflow stamps the certified flag on the run', async () => {
    renderModal({ workflow: invocable({ ...TOOLS, certified: true }) });
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'retire' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0][0].metadata).toEqual({ source: 'dashboard', certified: true });
  });

  it('submitting replaces the form with a working receipt that can be closed', async () => {
    const { onClose } = renderModal();
    await submitRetire();
    expect(screen.getByTestId('run-outcome')).toHaveTextContent('Working…');
    expect(screen.getByLabelText(/Serial/)).not.toBeVisible();
    expect(screen.queryByTestId('invoke-again')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-done'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a completed run reads as an outline with Done', async () => {
    const { onClose } = renderModal();
    await submitRetire();
    act(() => handler!(event('completed', { serialNumber: 'sn-1', details: { slots: ['slot-2'] } })));
    expect(screen.getByTestId('run-outcome')).toHaveTextContent('Completed');
    const outline = screen.getByTestId('run-outline');
    expect(outline).toHaveTextContent('serialNumber');
    expect(outline).toHaveTextContent('sn-1');
    expect(outline).toHaveTextContent('slot-2');
    expect(outline.textContent).not.toContain('{');
    expect(screen.getByTestId('run-done')).toHaveTextContent('Done');
    fireEvent.click(screen.getByTestId('run-done'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a failed run shows the reason and Try again returns to the form as typed', async () => {
    renderModal();
    await submitRetire();
    act(() => handler!(event('failed', { error: 'Printer offline' })));
    expect(screen.getByTestId('run-outcome')).toHaveTextContent('Failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Printer offline');
    expect(screen.queryByTestId('run-outline')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-retry'));
    expect(screen.queryByTestId('run-receipt')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Action/)).toHaveValue('retire');
    expect(screen.getByTestId('invoke-start')).toBeInTheDocument();
  });

  it('does not close on a backdrop click and starts clean when reopened', async () => {
    const { onClose, rerender } = renderModal();
    fireEvent.click(document.body.querySelector('.absolute.inset-0')!);
    expect(onClose).not.toHaveBeenCalled();

    await submitRetire();

    const props = { workflow: TOOLS, prefill: { data: {}, metadata: {} }, onClose };
    rerender(<MemoryRouter><InvokeModal open={false} {...props} /></MemoryRouter>);
    rerender(<MemoryRouter><InvokeModal open {...props} /></MemoryRouter>);
    expect(screen.getByTestId('invoke-start')).toBeInTheDocument();
    expect(screen.queryByTestId('run-receipt')).not.toBeInTheDocument();
  });
});
