import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The footer follows a started run: it subscribes to that run's completed and
// failed subjects and shows the outcome line plus the returned payload.
let patterns: string[] = [];
let handler: ((event: unknown) => void) | null = null;
vi.mock('../../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (p: string[], h: (event: unknown) => void) => { patterns = p; handler = h; },
  useEventStatus: () => ({ connected: true }),
}));

import { InvokeFooter } from '../InvokeFooter';
import { workflowEventPattern } from '../StartedRunNotice';

const event = (type: string, data?: Record<string, unknown>) => ({
  type, workflowId: 'wf-1', workflowName: 'fleetTools', taskQueue: 'q', source: 'interceptor', timestamp: '2026-01-01T00:00:00Z', data,
});

function renderStarted(executionPath: string | null = null) {
  return render(
    <MemoryRouter>
      <InvokeFooter onSubmit={vi.fn()} onSubmitAgain={vi.fn()} pending={false} error={null} startedId="wf-1" executionPath={executionPath} />
    </MemoryRouter>,
  );
}

beforeEach(() => { patterns = []; handler = null; });

describe('InvokeFooter — following a started run', () => {
  it('subscribes to the run\'s completed and failed subjects as soon as it starts', () => {
    renderStarted();
    expect(patterns).toEqual([
      'lt.events.system.workflow.wf-1.completed',
      'lt.events.system.workflow.wf-1.failed',
    ]);
    expect(workflowEventPattern('abc', 'completed')).toBe('lt.events.system.workflow.abc.completed');
    expect(screen.getByTestId('started-run')).toHaveTextContent('Started');
    expect(screen.queryByTestId('started-run-result')).not.toBeInTheDocument();
  });

  it('shows the result payload below the row when the completed event lands', () => {
    renderStarted();
    act(() => handler!(event('system.workflow.wf-1.completed', { serialNumber: 'printer-07', action: 'retire' })));
    expect(screen.getByTestId('started-run')).toHaveTextContent('Completed');
    const result = screen.getByTestId('started-run-result');
    expect(result).toHaveTextContent('printer-07');
    // The result zone sits after the status row, full width, fixed height.
    expect(screen.getByTestId('started-run').compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(result.className).toContain('h-48');
    expect(result.className).toContain('overflow-y-auto');
  });

  it('a completed event without a payload reports completion alone', () => {
    renderStarted();
    act(() => handler!(event('system.workflow.wf-1.completed')));
    expect(screen.getByTestId('started-run')).toHaveTextContent('Completed');
    expect(screen.queryByTestId('started-run-result')).not.toBeInTheDocument();
  });

  it('a failed event reads as failure', () => {
    renderStarted();
    act(() => handler!(event('system.workflow.wf-1.failed', { error: 'boom' })));
    expect(screen.getByTestId('started-run')).toHaveTextContent('Failed');
    expect(screen.getByTestId('started-run-result')).toHaveTextContent('boom');
  });

  it('ignores another run\'s event and offers the execution link when given one', () => {
    renderStarted('/workflows/executions/wf-1');
    act(() => handler!({ ...event('system.workflow.wf-2.completed', { x: 1 }), workflowId: 'wf-2' }));
    expect(screen.getByTestId('started-run')).toHaveTextContent('Started');
    expect(screen.getByRole('link', { name: /View workflow/ })).toHaveAttribute('href', '/workflows/executions/wf-1');
  });
});
