import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../../api/client', async (io) => ({
  ...(await io<typeof import('../../../api/client')>()),
  apiFetch: mocks.apiFetch,
}));

import { InspectForm, parsePayload } from '../InspectForm';

function renderForm() {
  return render(
    <MemoryRouter>
      <InspectForm siteId="acme" lineId="l1" />
    </MemoryRouter>,
  );
}

function fill(topic: string, payload: string, retained: 'live' | 'retained') {
  fireEvent.change(screen.getByLabelText(/^Topic/), { target: { value: topic } });
  fireEvent.change(screen.getByLabelText('Payload'), { target: { value: payload } });
  fireEvent.change(screen.getByLabelText(/^Delivery/), { target: { value: retained } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
});

describe('parsePayload', () => {
  it('sends JSON as JSON and anything else as text', () => {
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
    expect(parsePayload('plain text')).toBe('plain text');
    expect(parsePayload('')).toBe('');
  });
});

describe('InspectForm', () => {
  it('posts topic, payload and retained to the inspect route', async () => {
    mocks.apiFetch.mockResolvedValue({ kind: 'job', event: 'arrived', violations: [], actions: [] });
    renderForm();
    fill('acme/l1/m1/job', '{"unitId":"U1"}', 'retained');
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/machines/lines/acme/l1/inspect');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ topic: 'acme/l1/m1/job', payload: { unitId: 'U1' }, retained: true });
    expect(await screen.findByText('job · arrived · matches the contract')).toHaveClass('text-status-success');
  });

  it('renders violations in the warning tone and the planned actions with row links', async () => {
    mocks.apiFetch.mockResolvedValue({
      kind: 'job',
      event: 'arrived',
      summary: 'job arrived U1',
      violations: ['unitId is required', 'carrier unknown'],
      actions: [
        { verb: 'accumulate', rowId: 'row-3', itemKey: 'arrived:U1' },
        { verb: 'refuse', detail: 'no open row' },
        { verb: 'none' },
      ],
    });
    renderForm();
    fill('acme/l1/m1/job', '{}', 'live');
    expect(await screen.findByText('job · arrived · 2 violations')).toHaveClass('text-status-warning');
    expect(screen.getByText('unitId is required')).toHaveClass('text-status-warning');
    expect(screen.getByText('carrier unknown')).toBeInTheDocument();
    expect(screen.getByText('accumulated arrived:U1')).toBeInTheDocument();
    expect(screen.getByText('row-3')).toHaveAttribute('href', '/escalations/detail/row-3');
    expect(screen.getByText('refused')).toHaveClass('text-status-error');
    expect(screen.getByRole('list', { name: 'Planned actions' }).querySelectorAll('li')).toHaveLength(2);
  });

  it('shows a refusal from the server in the error tone', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('This replica is standing by.'));
    renderForm();
    fill('acme/l1/m1/job', '', 'live');
    expect(await screen.findByText('This replica is standing by.')).toHaveClass('text-status-error');
  });
});
