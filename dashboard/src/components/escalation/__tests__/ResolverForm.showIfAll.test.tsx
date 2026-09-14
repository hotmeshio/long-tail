import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

// x-lt-showIf as an array: the field renders only while every condition holds.
const schema = {
  properties: {
    action: { type: 'string', enum: ['report-offline', 'retire'] },
    powerCycled: { type: 'boolean', title: 'Power cycled' },
    powerCycleFirst: {
      type: 'string',
      title: 'Power cycle first',
      'x-lt-showIf': ['resolver.action=report-offline', '!resolver.powerCycled'],
    },
    legacy: { type: 'string', title: 'Legacy single', 'x-lt-showIf': 'resolver.action=retire' },
  },
};

function renderWith(fields: Record<string, unknown>) {
  render(<ResolverForm value={JSON.stringify({ ...fields, _form_schema: schema })} onChange={vi.fn()} />);
}

describe('ResolverForm — x-lt-showIf array', () => {
  it('shows the field when every condition holds', () => {
    renderWith({ action: 'report-offline', powerCycled: false, powerCycleFirst: '', legacy: '' });
    expect(screen.getByLabelText(/Power cycle first/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legacy single/)).not.toBeInTheDocument();
  });

  it('hides it when the action differs', () => {
    renderWith({ action: 'retire', powerCycled: false, powerCycleFirst: '', legacy: '' });
    expect(screen.queryByLabelText(/Power cycle first/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Legacy single/)).toBeInTheDocument();
  });

  it('hides it when the second condition fails', () => {
    renderWith({ action: 'report-offline', powerCycled: true, powerCycleFirst: '', legacy: '' });
    expect(screen.queryByLabelText(/Power cycle first/)).not.toBeInTheDocument();
  });
});
