import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InfoChoiceScreen } from '../InfoChoiceScreen';
import { setDisplayTimeZone } from '../../../../lib/display-zone';
import type { ScanExecuteResponse } from '../../../../api/scan-codes';

vi.mock('../../../../hooks/useScanInput', () => ({ useScanInput: () => ({ pushCodeInterceptor: () => () => {} }) }));
vi.mock('../HeldRoster', () => ({
  HeldRoster: ({ escalationId, field }: { escalationId: string; field: string }) => <div data-testid="present-roster">{escalationId}:{field}</div>,
}));

const response = (facts: ScanExecuteResponse['facts']): ScanExecuteResponse => ({
  outcome: 'choices',
  rule: { schemeVersion: 13, category: '1', name: 'Pack this bin' },
  stepIndex: 0,
  escalation: { id: 'b1', status: 'pending', role: 'consolidate', type: 'rollup', subtype: 'bin', assigned_to: null, metadata: {} },
  choices: [{ index: 0, label: 'Start packing', verb: 'claim', withheld: false }],
  facts,
} as ScanExecuteResponse);

afterEach(() => setDisplayTimeZone(null));

describe('station facts with a format', () => {
  it('render a date as the list does, in the display zone', () => {
    setDisplayTimeZone('America/Chicago');
    render(
      <InfoChoiceScreen
        response={response([
          { label: 'Tub', value: 'SF-A-3' },
          { label: 'Ship by', value: '2026-10-13T06:02:02.619Z', format: 'date' },
        ])}
        hasActingIdentity={false}
        selfId="u1"
        busy={false}
        onExecute={vi.fn() as never}
        onWithheldSelect={vi.fn()}
      />,
    );
    const values = screen.getAllByTestId('station-fact-value').map((v) => v.textContent);
    expect(values).toEqual(['SF-A-3', 'Oct 13, 2026 1:02 AM']);
  });
});

describe('present show', () => {
  it('renders the row\'s roster above the choices', () => {
    render(
      <InfoChoiceScreen
        response={{ ...response(undefined), show: 'tubRoster' }}
        hasActingIdentity={false}
        selfId="u1"
        busy={false}
        onExecute={vi.fn() as never}
        onWithheldSelect={vi.fn()}
      />,
    );
    const roster = screen.getByTestId('present-roster');
    expect(roster.textContent).toBe('b1:tubRoster');
    expect(roster.compareDocumentPosition(screen.getByRole('button', { name: /Start packing/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no show, no roster', () => {
    render(
      <InfoChoiceScreen response={response(undefined)} hasActingIdentity={false} selfId="u1" busy={false} onExecute={vi.fn() as never} onWithheldSelect={vi.fn()} />,
    );
    expect(screen.queryByTestId('present-roster')).toBeNull();
  });
});
