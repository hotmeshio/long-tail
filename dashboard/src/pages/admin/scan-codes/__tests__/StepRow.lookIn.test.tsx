import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { ScanRuleEditor } from '../ScanRuleEditor';
import type { ScanRule } from '../../../../api/scan-codes';

// "Look in" is a multi-select over query.roles[] — a rule spanning N queues
// must show all N, and a round-trip through the editor must never narrow the
// set (the field previously rendered roles[0] and collapsed the array on save).

vi.mock('../../../../api/client', () => ({
  apiFetch: vi.fn(),
}));
import { apiFetch } from '../../../../api/client';
const apiFetchMock = vi.mocked(apiFetch);

const THREE_QUEUES = ['queue-a', 'queue-b', 'queue-c'];

const rule: ScanRule = {
  scheme_version: 10,
  category: '4',
  name: 'Work it',
  steps: [{ query: { roles: [...THREE_QUEUES], availability: 'available' }, verb: 'show-detail' }],
  fallback: { markdown: 'Nothing here.' },
  notPrimed: { markdown: 'Badge please.' },
  enabled: true,
};

function renderEditor(r: ScanRule = rule) {
  return renderWithProviders(
    <ScanRuleEditor
      schemeVersion={10}
      schemeKind="action"
      category="4"
      rule={r}
      codePreview="10:4:SN-1234"
      onDeleted={() => {}}
    />,
  );
}

async function savedStep(): Promise<Record<string, any>> {
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => {
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/scan-codes/schemes/10/actions/4',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
  const call = apiFetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')!;
  return JSON.parse((call[1] as RequestInit).body as string).steps[0];
}

describe('StepRow — "Look in" multi-select', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({
      roles: [...THREE_QUEUES, 'queue-d'].map((role) => ({ role })),
    });
  });

  it('renders every targeted queue, not just the first', () => {
    renderEditor();
    for (const q of THREE_QUEUES) {
      expect(screen.getByTitle(`Remove ${q}`)).toBeInTheDocument();
    }
  });

  it('editing an unrelated field and saving never narrows the set', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(/Held by/), { target: { value: 'mine' } });
    const step = await savedStep();
    expect(step.query.roles).toEqual(THREE_QUEUES);
    expect(step.query.availability).toBe('mine');
  });

  it('adds and removes queues, preserving the full array on save', async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Add a queue'), { target: { value: 'queue-d' } });
    fireEvent.click(screen.getByTitle('Remove queue-b'));

    const step = await savedStep();
    expect(step.query.roles).toEqual(['queue-a', 'queue-c', 'queue-d']);
  });

  it('clearing every queue persists as "any" (roles absent) with the explicit empty state', async () => {
    renderEditor();
    for (const q of THREE_QUEUES) {
      fireEvent.click(screen.getByTitle(`Remove ${q}`));
    }
    expect(screen.getByText('Any queue I can see')).toBeInTheDocument();

    const step = await savedStep();
    expect(step.query.roles).toBeUndefined();
  });
});
