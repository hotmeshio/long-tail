import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../resolver-form/ResolverForm';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

// x-lt-confidence: tranche tone on each scored field, the review key, and
// what an answer was against what it became, live and after submit.

const SCHEMA = {
  'x-lt-confidence': {
    tranches: [
      { below: 0.6, label: 'Low', tone: 'error' },
      { below: 0.9, label: 'Check', tone: 'warning' },
    ],
  },
  properties: {
    first_name: { type: 'string', title: 'First name' },
    last_name: { type: 'string', title: 'Last name' },
    member_id: { type: 'string', title: 'Member ID' },
    plan: { type: 'string', title: 'Plan', 'x-lt-bind': 'coverage.plan' },
    notes: { type: 'string', title: 'Notes', 'x-lt-confidence': false },
  },
};

const CTX: ShowIfContext = {
  envelope: {
    formDefaults: { first_name: 'Jon', last_name: 'Smith', member_id: 'A-17', coverage: { plan: 'PPO' } },
    confidence: { first_name: 0.55, last_name: 0.97, member_id: 0.8, coverage: { plan: 0.4 }, notes: 0.1 },
  },
};

function json(values: Record<string, unknown>) {
  return JSON.stringify({ ...values, _form_schema: SCHEMA });
}

const PROPOSED = { first_name: 'Jon', last_name: 'Smith', member_id: 'A-17', plan: 'PPO', notes: '' };

describe('ResolverForm review', () => {
  it('marks each scored field with its tranche, by bound path, and leaves confident fields plain', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX} />);
    expect(screen.getByTestId('review-first_name')).toHaveAttribute('data-confidence-tone', 'error');
    expect(screen.getByTestId('review-tranche-first_name')).toHaveTextContent('Low· 55%');
    expect(screen.getByTestId('review-member_id')).toHaveAttribute('data-confidence-tone', 'warning');
    expect(screen.getByTestId('review-plan')).toHaveAttribute('data-confidence-tone', 'error');
    expect(screen.getByTestId('review-last_name')).not.toHaveAttribute('data-confidence-tone');
    expect(screen.queryByTestId('review-tranche-last_name')).toBeNull();
  });

  it('skips a field that opts out', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX} />);
    expect(screen.queryByTestId('review-notes')).toBeNull();
  });

  it('counts each tranche in the review key', () => {
    render(<ResolverForm value={json(PROPOSED)} onChange={vi.fn()} escalationContext={CTX} />);
    const legend = screen.getByTestId('review-legend');
    expect(legend).toHaveTextContent('Low2');
    expect(legend).toHaveTextContent('Check1');
    expect(legend).not.toHaveTextContent('Edited');
  });

  it('shows Edited once an answer leaves the proposal, and Restore puts the proposal back', () => {
    const onChange = vi.fn();
    render(<ResolverForm value={json({ ...PROPOSED, first_name: 'John' })} onChange={onChange} escalationContext={CTX} />);
    expect(screen.getByTestId('review-legend')).toHaveTextContent('Edited1of 4');
    fireEvent.click(screen.getByTestId('review-edited-first_name'));
    expect(screen.getByText('Proposed').nextSibling).toHaveTextContent('Jon');
    fireEvent.click(screen.getByTestId('review-restore-first_name'));
    const emitted = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]);
    expect(emitted.first_name).toBe('Jon');
  });

  it('treats an untouched proposal as unchanged, whatever its scalar form', () => {
    render(<ResolverForm value={json({ ...PROPOSED, member_id: 'A-17' })} onChange={vi.fn()} escalationContext={CTX} />);
    expect(screen.queryByTestId('review-edited-member_id')).toBeNull();
  });

  it('on a locked form shows what each changed answer was and what it became', () => {
    render(<ResolverForm value={json({ ...PROPOSED, plan: 'HMO' })} onChange={vi.fn()} escalationContext={CTX} disabled />);
    const was = screen.getByTestId('review-was-plan');
    expect(was).toHaveTextContent('Was');
    expect(was.querySelector('s')).toHaveTextContent('PPO');
    expect(was).toHaveTextContent('HMO');
    expect(screen.queryByTestId('review-edited-plan')).toBeNull();
  });

  it('renders no review without the token', () => {
    const plain = JSON.stringify({ first_name: 'Jon', _form_schema: { properties: { first_name: { type: 'string' } } } });
    render(<ResolverForm value={plain} onChange={vi.fn()} escalationContext={CTX} />);
    expect(screen.queryByTestId('review-legend')).toBeNull();
    expect(screen.queryByTestId('review-first_name')).toBeNull();
  });
});
