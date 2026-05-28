import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IframeViewport } from '../IframeViewport';
import type { LTEscalationRecord } from '../../../api/types';

const IFRAME_SRC = 'https://custom-app.example.com/form';

const mockEscalation: LTEscalationRecord = {
  id: 'esc-123',
  type: 'intake',
  subtype: 'rich-form',
  description: 'Test escalation',
  status: 'pending',
  priority: 2,
  role: 'reviewer',
  workflow_type: 'richForm',
  task_id: null,
  origin_id: null,
  parent_id: null,
  workflow_id: 'wf-123',
  task_queue: 'test-queue',
  assigned_to: null,
  assigned_until: null,
  resolved_at: null,
  claimed_at: null,
  envelope: '{}',
  metadata: null,
  escalation_payload: null,
  resolver_payload: null,
  trace_id: null,
  span_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: null,
};

describe('IframeViewport', () => {
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    // Capture the message event listener
    const origAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
      if (type === 'message') messageHandler = handler as (event: MessageEvent) => void;
      return origAdd(type, handler, options);
    });
  });

  afterEach(() => {
    messageHandler = null;
    vi.restoreAllMocks();
  });

  it('renders an iframe with the provided src', () => {
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={vi.fn()}
        onEscalate={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle('HITL Viewport') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe(IFRAME_SRC);
  });

  it('sets sandbox attribute on iframe', () => {
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={vi.fn()}
        onEscalate={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle('HITL Viewport') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('calls onResolve when lt:submit message received from correct origin', () => {
    const onResolve = vi.fn();
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={onResolve}
        onEscalate={vi.fn()}
      />,
    );

    act(() => {
      messageHandler?.({
        origin: 'https://custom-app.example.com',
        data: { type: 'lt:submit', payload: { approved: true } },
      } as MessageEvent);
    });

    expect(onResolve).toHaveBeenCalledWith({ approved: true });
  });

  it('calls onEscalate when lt:escalate message received', () => {
    const onEscalate = vi.fn();
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={vi.fn()}
        onEscalate={onEscalate}
      />,
    );

    act(() => {
      messageHandler?.({
        origin: 'https://custom-app.example.com',
        data: { type: 'lt:escalate', target: 'manager' },
      } as MessageEvent);
    });

    expect(onEscalate).toHaveBeenCalledWith('manager');
  });

  it('ignores messages from wrong origin', () => {
    const onResolve = vi.fn();
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={onResolve}
        onEscalate={vi.fn()}
      />,
    );

    act(() => {
      messageHandler?.({
        origin: 'https://evil.example.com',
        data: { type: 'lt:submit', payload: { hacked: true } },
      } as MessageEvent);
    });

    expect(onResolve).not.toHaveBeenCalled();
  });

  it('ignores messages with invalid data', () => {
    const onResolve = vi.fn();
    render(
      <IframeViewport
        src={IFRAME_SRC}
        escalation={mockEscalation}
        schema={{ properties: {} }}
        onResolve={onResolve}
        onEscalate={vi.fn()}
      />,
    );

    act(() => {
      messageHandler?.({
        origin: 'https://custom-app.example.com',
        data: 'not an object',
      } as MessageEvent);
    });

    expect(onResolve).not.toHaveBeenCalled();
  });
});
