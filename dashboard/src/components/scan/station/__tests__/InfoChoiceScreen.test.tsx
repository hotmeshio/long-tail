import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfoChoiceScreen } from '../InfoChoiceScreen';
import type { ScanExecuteResponse } from '../../../../api/scan-codes';

// The screen registers itself as the scan pipeline's code interceptor; the
// mock captures the registered function so tests can emit raw codes at it.
let interceptor: ((raw: string) => boolean) | null = null;
vi.mock('../../../../hooks/useScanInput', () => ({
  useScanInput: () => ({
    setCodeInterceptor: (fn: ((raw: string) => boolean) | null) => { interceptor = fn; },
  }),
}));

function choicesResponse(): ScanExecuteResponse {
  return {
    outcome: 'choices',
    rule: { schemeVersion: 10, category: '4', name: 'Order lifecycle' },
    stepIndex: 0,
    escalation: {
      id: 'esc-1',
      status: 'pending',
      role: 'packing',
      type: 'order',
      subtype: 'standard',
      description: 'Order 4412 — left insole',
      assigned_to: null,
      created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
      metadata: { orderId: '4412', serialNumber: 'SN-88' },
    },
    choices: [
      { index: 0, label: 'Collected', verb: 'resolve', code: 'COLLECT', withheld: false },
      { index: 1, label: 'Ship it', verb: 'escalate', requireActingIdentity: true, withheld: true },
      { index: 2, label: 'Scrap', verb: 'cancel', confirm: { prompt: 'Scrap this order for good?' }, withheld: false },
    ],
    notPrimed: {},
  };
}

function renderScreen(overrides?: { hasActingIdentity?: boolean; response?: ScanExecuteResponse; onExecute?: (c: unknown) => void }) {
  const onExecute = overrides?.onExecute ?? vi.fn();
  const onWithheldSelect = vi.fn();
  const view = render(
    <InfoChoiceScreen
      response={overrides?.response ?? choicesResponse()}
      hasActingIdentity={overrides?.hasActingIdentity ?? false}
      selfId="user-1"
      busy={false}
      onExecute={onExecute as never}
      onWithheldSelect={onWithheldSelect}
    />,
  );
  return { ...view, onExecute, onWithheldSelect };
}

describe('InfoChoiceScreen', () => {
  beforeEach(() => { interceptor = null; });

  it('hides plumbing metadata (form_schema, underscore keys) from the fact list', () => {
    const response = choicesResponse();
    (response.escalation as { metadata?: Record<string, unknown> }).metadata = {
      orderId: '4412',
      form_schema: { type: 'object', properties: { note: { type: 'string' } } },
      _internal: 'never shown',
    };
    renderScreen({ response });
    expect(screen.getByText('4412')).toBeInTheDocument();
    expect(screen.queryByText(/form_schema/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/"properties"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/never shown/)).not.toBeInTheDocument();
  });

  it('states the reality: description, queue, claim state, age, metadata', () => {
    renderScreen();
    expect(screen.getByText('Order 4412 — left insole')).toBeInTheDocument();
    expect(screen.getByText('packing')).toBeInTheDocument();
    expect(screen.getByText('order · standard')).toBeInTheDocument();
    expect(screen.getByText('Unclaimed')).toBeInTheDocument();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
    expect(screen.getByText('orderId')).toBeInTheDocument();
    expect(screen.getByText('4412')).toBeInTheDocument();
    expect(screen.getByText('SN-88')).toBeInTheDocument();
  });

  it('renders every choice as a plain, tappable button with no badge hint on this screen', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: /Collected/ })).toBeEnabled();
    // Withheld choices stay fully presented and tappable — no dimming, no hint.
    expect(screen.getByRole('button', { name: /Ship it/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Scrap/ })).toBeEnabled();
    expect(screen.queryByText(/scan your badge/i)).not.toBeInTheDocument();
  });

  it('tapping a withheld choice hands it off as pending instead of executing', () => {
    const { onExecute, onWithheldSelect } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Ship it/ }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(onWithheldSelect).toHaveBeenCalledWith(expect.objectContaining({ index: 1, label: 'Ship it' }));
  });

  it('never renders the notPrimed badge copy on this screen (deferred to the badge step)', () => {
    const response = { ...choicesResponse(), notPrimed: { markdown: '**Badge up** at the kiosk first.' } };
    renderScreen({ response });
    expect(screen.queryByText(/at the kiosk first/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ship it/ })).toBeEnabled();
  });

  it('withheld choices are tappable with or without an acting identity', () => {
    renderScreen({ hasActingIdentity: true });
    expect(screen.getByRole('button', { name: /Ship it/ })).toBeEnabled();
    expect(screen.queryByText(/scan your badge/i)).not.toBeInTheDocument();
  });

  it('executes an unguarded choice on tap', () => {
    const { onExecute } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Collected/ }));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ index: 0, label: 'Collected' }));
  });

  it('asks first when the choice carries a confirm, then executes', () => {
    const { onExecute } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Scrap/ }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByText('Scrap this order for good?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' }));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ index: 2, label: 'Scrap' }));
  });

  it('backing out of the confirm executes nothing', () => {
    const { onExecute } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Scrap/ }));
    fireEvent.click(screen.getByRole('button', { name: 'No, go back' }));
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('the interceptor consumes an enabled choice code and selects that choice', () => {
    const { onExecute } = renderScreen();
    expect(interceptor).toBeTypeOf('function');
    expect(interceptor!('COLLECT')).toBe(true);
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
  });

  it('the interceptor lets everything else fall through to normal execution', () => {
    const { onExecute } = renderScreen();
    expect(interceptor!('10:4:SN-1234')).toBe(false);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('a scanned confirm-guarded code raises the dialog instead of executing', () => {
    const response = choicesResponse();
    response.choices![2].code = 'SCRAP';
    const { onExecute } = renderScreen({ response });
    act(() => { expect(interceptor!('SCRAP')).toBe(true); });
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByText('Scrap this order for good?')).toBeInTheDocument();
  });

  it('unregisters the interceptor on unmount', () => {
    const { unmount } = renderScreen();
    expect(interceptor).toBeTypeOf('function');
    unmount();
    expect(interceptor).toBeNull();
  });
});
