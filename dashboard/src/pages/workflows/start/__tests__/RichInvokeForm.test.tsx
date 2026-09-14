import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RichInvokeForm } from '../RichInvokeForm';
import type { InvokeSubmission } from '../use-invoke-submit';
import { TOOLS, RICH_SCHEMA } from './invoke-test-data';

function submission(overrides: Partial<InvokeSubmission> = {}): InvokeSubmission {
  return {
    submit: vi.fn(async () => {}),
    reset: vi.fn(),
    pending: false,
    error: null,
    violations: [],
    startedId: null,
    executionPath: null,
    ...overrides,
  };
}

function renderForm(sub = submission(), props: { schema?: Record<string, unknown>; lookup?: Record<string, unknown> } = {}) {
  render(
    <MemoryRouter>
      <RichInvokeForm
        selected={TOOLS}
        schema={props.schema ?? RICH_SCHEMA}
        metadata={{ source: 'dashboard' }}
        lookup={props.lookup}
        submission={sub}
      />
    </MemoryRouter>,
  );
  return sub;
}

const LOOKUP_SCHEMA = {
  required: ['serialNumber'],
  properties: {
    serialNumber: { type: 'string', title: 'Serial', 'x-lt-options': 'lookup.serials.items' },
  },
};
const SERIALS = { serials: { items: [{ value: 'sn-1', label: 'Printer 1' }, { value: 'sn-2', label: 'Printer 2' }] } };

beforeEach(() => vi.clearAllMocks());

describe('RichInvokeForm', () => {
  it('renders the declared fields and hides conditional ones until the action selects them', () => {
    renderForm();
    expect(screen.getByLabelText(/Serial/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Action/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Copies/)).not.toBeInTheDocument();
    expect(screen.queryByText('Reprint tips')).not.toBeInTheDocument();
  });

  it('choosing an action reveals its section and its instruction block', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'reprint-label' } });
    expect(screen.getByLabelText(/Copies/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reprint tips' })).toBeInTheDocument();
  });

  it('a missing required field blocks the submit and counts the issues', () => {
    const sub = renderForm();
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(sub.submit).not.toHaveBeenCalled();
    expect(screen.getByTestId('invoke-issues')).toHaveTextContent('2 issues to resolve');
  });

  it('a complete form submits the x-lt-bind mapped data with the declared metadata', () => {
    const sub = renderForm();
    fireEvent.change(screen.getByLabelText(/Serial/), { target: { value: 'sn-1' } });
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'retire' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    // Hidden conditional fields ride along with their defaults, as on every x-lt-* form.
    expect(sub.submit).toHaveBeenCalledWith(
      { printer: { serialNumber: 'sn-1' }, tool: { action: 'retire' }, copies: 1, reprintTips: '### Reprint tips' },
      { source: 'dashboard' },
    );
  });

  it('x-lt-options over a pinned lookup renders the resolved edition as a select', () => {
    const sub = renderForm(submission(), { schema: LOOKUP_SCHEMA, lookup: SERIALS });
    const select = screen.getByLabelText(/Serial/) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Printer 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Printer 2' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'sn-2' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(sub.submit).toHaveBeenCalledWith({ serialNumber: 'sn-2' }, { source: 'dashboard' });
  });

  it('server violations surface as issues', () => {
    renderForm(submission({ violations: [{ field: 'serialNumber', message: 'Unknown serial' }], error: 'data failed input schema validation (1 violation)' }));
    expect(screen.getByTestId('invoke-issues')).toHaveTextContent('1 issue to resolve');
  });

  it('a started run is reported in the footer, with the execution link when the caller may open it', () => {
    renderForm(submission({ startedId: 'wf-9' }));
    expect(screen.getByRole('status')).toHaveTextContent('Started');
    expect(screen.getByRole('status')).toHaveTextContent('wf-9');
    expect(screen.queryByRole('link', { name: /View workflow/ })).not.toBeInTheDocument();
    renderForm(submission({ startedId: 'wf-10', executionPath: '/workflows/executions/wf-10' }));
    expect(screen.getByRole('link', { name: /View workflow/ })).toHaveAttribute('href', '/workflows/executions/wf-10');
  });
});
