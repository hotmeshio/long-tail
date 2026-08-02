import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { ScanRuleEditor } from '../ScanRuleEditor';
import type { ScanRule } from '../../../../api/scan-codes';

vi.mock('../../../../api/client', () => ({
  apiFetch: vi.fn().mockResolvedValue({ roles: [] }),
}));
import { apiFetch } from '../../../../api/client';
const apiFetchMock = vi.mocked(apiFetch);

const existingRule: ScanRule = {
  scheme_version: 10,
  category: '4',
  name: 'Order lifecycle',
  steps: [{ query: {}, verb: 'show-detail' }],
  fallback: { markdown: 'Nothing here.' },
  notPrimed: { markdown: 'Badge please.' },
  enabled: true,
};

function renderEditor(rule: ScanRule | null, schemeKind: 'action' | 'identity' = 'action') {
  return renderWithProviders(
    <ScanRuleEditor
      schemeVersion={10}
      schemeKind={schemeKind}
      category="4"
      rule={rule}
      codePreview="10:4:SN-1234"
      onDeleted={() => {}}
    />,
  );
}

/** The parsed body of the PUT the save button fired. */
async function savedRuleBody(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => {
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/scan-codes/schemes/10/actions/4',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
  const call = apiFetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('ScanRuleEditor', () => {
  beforeEach(() => { apiFetchMock.mockClear(); });

  it('selecting the present verb reveals the choice editor', () => {
    renderEditor(existingRule);
    expect(screen.queryByText('Add a choice')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Then/), { target: { value: 'present' } });
    expect(screen.getByText('Add a choice')).toBeInTheDocument();
  });

  it('edits choices through the choice editor and saves them on the step', async () => {
    renderEditor(existingRule);
    fireEvent.change(screen.getByLabelText(/Then/), { target: { value: 'present' } });
    fireEvent.click(screen.getByText('Add a choice'));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Collected' } });
    fireEvent.change(screen.getByLabelText(/Code/), { target: { value: 'COLLECT' } });

    const body = await savedRuleBody();
    const step = (body.steps as any[])[0];
    expect(step.verb).toBe('present');
    expect(step.choices).toEqual([
      expect.objectContaining({ label: 'Collected', code: 'COLLECT' }),
    ]);
  });

  it('round-trips the notPrimed markdown', async () => {
    renderEditor(existingRule);
    const textarea = screen.getByLabelText(/When a badge is required/);
    expect(textarea).toHaveValue('Badge please.');

    fireEvent.change(textarea, { target: { value: 'Scan your badge first.' } });
    const body = await savedRuleBody();
    expect(body.notPrimed).toEqual({ markdown: 'Scan your badge first.' });
    expect(body.fallback).toEqual({ markdown: 'Nothing here.' });
  });

  it('offers the auto-select knob only for single-choice present steps', () => {
    renderEditor(existingRule);
    expect(screen.queryByLabelText('Auto-select the single choice')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Then/), { target: { value: 'present' } });
    expect(screen.queryByLabelText('Auto-select the single choice')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add a choice'));
    expect(screen.getByLabelText('Auto-select the single choice')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add a choice'));
    expect(screen.queryByLabelText('Auto-select the single choice')).not.toBeInTheDocument();
  });

  it('saves auto-select on a single-choice present step', async () => {
    renderEditor(existingRule);
    fireEvent.change(screen.getByLabelText(/Then/), { target: { value: 'present' } });
    fireEvent.click(screen.getByText('Add a choice'));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Claim & Work' } });
    fireEvent.click(screen.getByLabelText('Auto-select the single choice'));

    const body = await savedRuleBody();
    const step = (body.steps as any[])[0];
    expect(step.verb).toBe('present');
    expect(step.autoSelectSingle).toBe(true);
  });

  it('saves the per-step acting-identity requirement', async () => {
    renderEditor(existingRule);
    fireEvent.click(screen.getByLabelText('Requires acting identity'));

    const body = await savedRuleBody();
    expect((body.steps as any[])[0].requireActingIdentity).toBe(true);
  });

  it('collapses to name + unknown-badge message for identity schemes', () => {
    renderEditor(null, 'identity');
    expect(screen.queryByText(/Conditions and actions/)).not.toBeInTheDocument();
    expect(screen.queryByText('Add a step')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/When a badge is required/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/When the badge is unknown/)).toBeInTheDocument();
  });

  it('an identity rule saves with no steps', async () => {
    renderEditor(null, 'identity');
    fireEvent.change(screen.getByLabelText(/Friendly name/), { target: { value: 'Associate badge' } });
    fireEvent.change(screen.getByLabelText(/When the badge is unknown/), {
      target: { value: 'Badge not recognized.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create rule 10:4' }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/scan-codes/schemes/10/actions/4',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const call = apiFetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.steps).toEqual([]);
    expect(body.fallback).toEqual({ markdown: 'Badge not recognized.' });
  });
});
