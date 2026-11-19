import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../../api/client', async (io) => ({
  ...(await io<typeof import('../../../api/client')>()),
  apiFetch: mocks.apiFetch,
}));

import { CommandForm, SnapshotButton } from '../CommandForm';
import { SNAPSHOT_OP, type LineSummaryMachine } from '../../../api/machines';

const SETPOINT = {
  type: 'object', required: ['name', 'value'],
  properties: { name: { type: 'string', title: 'Name' }, value: { type: 'number', title: 'Value' } },
};

const machine: LineSummaryMachine = {
  machineId: 'm1', process: 'press', role: 'press-line', address: null, addressing: 'declared', rowOps: ['purge', 'setpoint'],
  commandOps: ['stop', 'cancel', SNAPSHOT_OP, 'purge', 'setpoint'], opArgs: { setpoint: SETPOINT },
};

function renderForm() {
  return render(
    <MemoryRouter>
      <CommandForm siteId="acme" lineId="l1" machine={machine} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue({ rowId: 'row-9' });
});

describe('CommandForm', () => {
  it('offers exactly the ops the line\'s codec declares', () => {
    renderForm();
    const options = Array.from(screen.getByLabelText(/^Op/).querySelectorAll('option')).map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['stop', 'cancel', SNAPSHOT_OP, 'purge', 'setpoint']);
  });

  it('renders an op\'s declared args as fields, and posts them once they pass', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Op/), { target: { value: 'setpoint' } });
    expect(screen.queryByLabelText('Args')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/name/i, { selector: '[data-testid="command-outcome"] *' })).toHaveClass('text-status-error');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'platen-temp' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ op: 'setpoint', args: { name: 'platen-temp', value: 7 } });
  });

  it('posts op and args to the machine commands route', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Op/), { target: { value: 'stop' } });
    fireEvent.change(screen.getByLabelText('Args'), { target: { value: '{"jobId":"J1"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/machines/lines/acme/l1/machines/m1/commands');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ op: 'stop', args: { jobId: 'J1' } });
    expect(await screen.findByText('row-9')).toHaveAttribute('href', '/escalations/detail/row-9');
  });

  it('adds a helper key to the args', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '+ jobId' }));
    expect(JSON.parse((screen.getByLabelText('Args') as HTMLTextAreaElement).value)).toEqual({ jobId: '' });
  });

  it('shows the refusal in the error tone without posting bad args', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Op/), { target: { value: 'stop' } });
    fireEvent.change(screen.getByLabelText('Args'), { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Args must be a JSON object.')).toHaveClass('text-status-error');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

describe('SnapshotButton', () => {
  it('posts the snapshot op with empty args', async () => {
    render(
      <MemoryRouter>
        <SnapshotButton siteId="acme" lineId="l1" machineId="m1" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a snapshot' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/machines/lines/acme/l1/machines/m1/commands');
    expect(JSON.parse(init.body)).toEqual({ op: SNAPSHOT_OP, args: {} });
  });
});
