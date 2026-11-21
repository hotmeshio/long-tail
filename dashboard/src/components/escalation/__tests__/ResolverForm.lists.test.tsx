import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../resolver-form/ResolverForm';
import { buildResolverPayload } from '../../../lib/resolver-payload';
import { seedFormJson } from '../../../lib/seed-form-json';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

// Lists in the review form: the same Added, Removed and Edited marks while
// editing and after submit, item scores, and null against an empty list.

const SCHEMA = {
  'x-lt-confidence': { tranches: [{ below: 0.6, label: 'Low', tone: 'error' }, { below: 0.9, label: 'Check', tone: 'warning' }] },
  properties: {
    codes: { type: ['array', 'null'], title: 'Diagnosis codes', items: { type: 'string' }, 'x-lt-unordered': true },
    conditions: {
      type: ['array', 'null'],
      title: 'Conditions',
      items: { type: 'string' },
      'x-lt-options': [{ value: 'neuropathy', label: 'Peripheral neuropathy' }, { value: 'deformity', label: 'Foot deformity' }],
    },
    lines: {
      type: ['array', 'null'],
      title: 'Order lines',
      'x-lt-item-key': 'code',
      items: { type: 'object', properties: { code: { type: 'string', title: 'Code' }, qty: { type: 'integer', title: 'Qty' } } },
    },
  },
};
const PROPOSED = {
  codes: ['E11.65', 'E11.42'],
  conditions: ['neuropathy'],
  lines: [{ code: 'A5500', qty: 2 }, { code: 'A5501', qty: 1 }],
};
const CTX = (confidence: unknown): ShowIfContext => ({ envelope: { formDefaults: PROPOSED, confidence } }) as ShowIfContext;
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as string;
const json = (values: Record<string, unknown>) => JSON.stringify({ ...values, _form_schema: SCHEMA });

describe('list review while editing', () => {
  it('marks an added pill, shows a removed one struck through with Restore, and counts the field once', () => {
    const onChange = vi.fn();
    render(<ResolverForm value={json({ ...PROPOSED, codes: ['E11.65', 'I73.9'] })} onChange={onChange} escalationContext={CTX({})} />);
    expect(screen.getByText('I73.9').closest('[data-pill]')!.getAttribute('data-tone')).toBe('added');
    const removed = screen.getByText('E11.42').closest('[data-pill]')!;
    expect(removed.getAttribute('data-tone')).toBe('removed');
    fireEvent.click(within(removed as HTMLElement).getByLabelText('Restore E11.42'));
    const next = JSON.parse(lastCall(onChange));
    expect(next.codes).toEqual(['E11.65', 'E11.42', 'I73.9']);
    expect(screen.getByTestId('review-legend')).toHaveTextContent('Edited');
  });

  it('shows the whole-list proposal in words and restores it, including a proposed null', () => {
    const onChange = vi.fn();
    render(<ResolverForm value={json({ ...PROPOSED, codes: [] })} onChange={onChange} escalationContext={CTX({})} />);
    fireEvent.click(screen.getByTestId('review-edited-codes'));
    expect(screen.getByText('E11.65; E11.42')).toBeTruthy();
    fireEvent.click(screen.getByTestId('review-restore-codes'));
    expect(JSON.parse(lastCall(onChange)).codes).toEqual(['E11.65', 'E11.42']);
  });

  it('restores a proposed null as null, not an empty answer', () => {
    const onChange = vi.fn();
    const ctx = { envelope: { formDefaults: { ...PROPOSED, codes: null }, confidence: {} } } as ShowIfContext;
    render(<ResolverForm value={json({ ...PROPOSED, codes: ['A11'] })} onChange={onChange} escalationContext={ctx} />);
    fireEvent.click(screen.getByTestId('review-edited-codes'));
    expect(screen.getByText('Not stated')).toBeTruthy();
    fireEvent.click(screen.getByTestId('review-restore-codes'));
    expect(JSON.parse(lastCall(onChange)).codes).toBeNull();
  });

  it('marks an edited cell with its proposed value and a removed row, restoring both', () => {
    const onChange = vi.fn();
    render(<ResolverForm value={json({ ...PROPOSED, lines: [{ code: 'A5500', qty: 5 }] })} onChange={onChange} escalationContext={CTX({})} />);
    expect(screen.getByText('Edited · was 2')).toBeTruthy();
    expect(screen.getByTestId('rows-removed-lines')).toHaveTextContent('Code A5501, Qty 1');
    fireEvent.click(within(screen.getByTestId('rows-removed-lines')).getByText('Restore'));
    expect(JSON.parse(lastCall(onChange)).lines).toEqual([{ code: 'A5500', qty: 5 }, { code: 'A5501', qty: 1 }]);
  });

  it('gives each item its own tone from an aligned score array and the field the worst of them', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX({ codes: [0.95, 0.4] })} />);
    expect(screen.getByText('E11.65').closest('[data-pill]')).not.toHaveAttribute('data-confidence-pill');
    expect(screen.getByText('E11.42').closest('[data-pill]')).toHaveAttribute('data-confidence-pill', 'error');
    expect(screen.getByTestId('review-tranche-codes')).toHaveTextContent('Low· 40%');
    expect(screen.getByTestId('review-codes')).not.toHaveAttribute('data-confidence-tone');
  });

  it('puts a list-level score on the control like any field', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX({ codes: 0.79 })} />);
    expect(screen.getByTestId('review-codes')).toHaveAttribute('data-confidence-tone', 'warning');
    expect(screen.getByTestId('review-tranche-codes')).toHaveTextContent('Check· 79%');
  });

  it('marks the one row cell scored low', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX({ lines: [{ code: 0.99, qty: 0.55 }, { code: 0.99, qty: 0.99 }] })} />);
    const cell = document.querySelector('[data-cell="0:qty"]')!;
    expect(cell.getAttribute('data-confidence-tone')).toBe('error');
    expect(document.querySelector('[data-cell="0:code"]')!.getAttribute('data-confidence-tone')).toBeNull();
  });
});

describe('closed option lists', () => {
  it('reads the same picks in option order as unchanged, however the model ordered them', () => {
    const ctx = { envelope: { formDefaults: { ...PROPOSED, conditions: ['deformity', 'neuropathy'] }, confidence: {} } } as ShowIfContext;
    render(<ResolverForm value={json({ ...PROPOSED, conditions: ['neuropathy', 'deformity'] })} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.getByTestId('review-conditions')).not.toHaveAttribute('data-review-changed');
    expect(screen.queryByTestId('review-edited-conditions')).toBeNull();
  });

  it('gives an added pill no score of its own in an unordered list', () => {
    const unordered = { ...SCHEMA, properties: { ...SCHEMA.properties, codes: { ...SCHEMA.properties.codes } } };
    render(
      <ResolverForm
        value={JSON.stringify({ ...PROPOSED, codes: ['E11.65', 'Z00.0'], _form_schema: unordered })}
        onChange={vi.fn()}
        escalationContext={CTX({ codes: [0.97, 0.4] })}
      />,
    );
    expect(screen.getByText('Z00.0').closest('[data-pill]')).not.toHaveAttribute('data-confidence-pill');
    expect(screen.getByText('E11.65').closest('[data-pill]')).not.toHaveAttribute('data-confidence-pill');
  });
});

describe('list review after submit', () => {
  it('shows the submitted list read-only with the same marks and option labels, never raw JSON', () => {
    render(
      <ResolverForm
        disabled
        value={json({ codes: ['E11.65', 'I73.9'], conditions: ['deformity'], lines: [{ code: 'A5500', qty: 5 }] })}
        onChange={vi.fn()}
        escalationContext={CTX({})}
      />,
    );
    expect(screen.getByText('I73.9').closest('[data-pill]')!.getAttribute('data-tone')).toBe('added');
    expect(screen.getByText('Foot deformity')).toBeTruthy();
    expect(screen.queryByText(/\[/)).toBeNull();
    expect(screen.getByText('Edited · was 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove|Restore|Add/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('null and empty', () => {
  it('seeds a nullable list with no proposal as not stated, and a proposed null stays null', () => {
    const seeded = JSON.parse(seedFormJson(SCHEMA, {}));
    expect(seeded.codes).toBeNull();
    const withNull = JSON.parse(seedFormJson(SCHEMA, { codes: null, lines: [] }));
    expect(withNull.codes).toBeNull();
    expect(withNull.lines).toEqual([]);
  });

  it('submits an untouched null as null and an emptied list as an empty list', () => {
    const untouched = buildResolverPayload(seedFormJson(SCHEMA, { codes: null, lines: null, conditions: null }));
    expect(untouched.payload).toMatchObject({ codes: null, lines: null, conditions: null });
    const emptied = buildResolverPayload(json({ ...PROPOSED, codes: [] }));
    expect(emptied.payload).toMatchObject({ codes: [] });
  });

  it('drops a row left entirely empty before validating', () => {
    const result = buildResolverPayload(json({ ...PROPOSED, lines: [{ code: 'A5500', qty: 2 }, { code: '', qty: '' }] }));
    expect(result.errors).toEqual([]);
    expect((result.payload as any).lines).toEqual([{ code: 'A5500', qty: 2 }]);
  });
});
