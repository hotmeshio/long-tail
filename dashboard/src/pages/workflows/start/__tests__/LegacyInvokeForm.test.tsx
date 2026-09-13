import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegacyInvokeForm } from '../LegacyInvokeForm';
import type { InvokeSubmission } from '../use-invoke-submit';
import { REVIEW, CLAIM } from './invoke-test-data';

function submission(): InvokeSubmission {
  return { submit: vi.fn(async () => {}), reset: vi.fn(), pending: false, error: null, violations: [], startedId: null, executionPath: null };
}

function renderForm(selected = REVIEW, sub = submission()) {
  render(
    <MemoryRouter>
      <LegacyInvokeForm selected={selected} metadata={{ source: 'dashboard' }} submission={sub} />
    </MemoryRouter>,
  );
  return sub;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('LegacyInvokeForm', () => {
  it('infers fields from the envelope template and submits them as data with the metadata', () => {
    const sub = renderForm();
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(sub.submit).toHaveBeenCalledWith({ message: 'changed', copies: 1 }, { source: 'dashboard' });
  });

  it('the JSON view edits the whole envelope', () => {
    const sub = renderForm();
    fireEvent.click(screen.getByText('JSON view'));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"data":{"message":"raw"},"metadata":{"k":1}}' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(sub.submit).toHaveBeenCalledWith({ message: 'raw' }, { k: 1 });
  });

  it('malformed JSON is refused inline', () => {
    const sub = renderForm();
    fireEvent.click(screen.getByText('JSON view'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{nope' } });
    fireEvent.click(screen.getByTestId('invoke-start'));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
    expect(sub.submit).not.toHaveBeenCalled();
  });

  it('a registry hand-off in sessionStorage opens in JSON view with its content', () => {
    sessionStorage.setItem('lt:invoke:prefill', '{"data":{"orderId":"o-1"},"metadata":{}}');
    renderForm(CLAIM);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('o-1');
    expect(sessionStorage.getItem('lt:invoke:prefill')).toBeNull();
  });
});
