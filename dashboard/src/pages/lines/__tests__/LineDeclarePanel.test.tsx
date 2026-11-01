import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../../api/client', async (io) => ({
  ...(await io<typeof import('../../../api/client')>()),
  apiFetch: mocks.apiFetch,
}));

import { LineDeclarePanel } from '../LineDeclarePanel';
import { ApiError } from '../../../api/client';
import type { LineIndexRow } from '../../../api/machines';

const stored: LineIndexRow = {
  siteId: 'north', lineId: 'line-1', leading: true, source: 'api', version: 3, enabled: true, updatedAt: '2026-10-31T10:00:00.000Z',
  machines: [{ machineId: 'print-01', process: 'print', role: 'line-print', address: null, addressing: 'declared' }],
  health: { machines: 1, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false },
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
});

describe('LineDeclarePanel', () => {
  it('declares the typed definition and reports the outcome', async () => {
    mocks.apiFetch.mockResolvedValue({ line: { ...stored, siteId: 'site-2', version: 1, machines: [stored.machines[0], stored.machines[0], stored.machines[0]] } });
    const onDone = vi.fn();
    render(<LineDeclarePanel initial={null} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText('Declare a line')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Declare' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [path, init] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/machines/lines/site-2/line-1');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.definition.siteId).toBe('site-2');
    expect(body.definition.machines).toHaveLength(3);
    expect(body.version).toBeUndefined();
    expect(screen.getByTestId('declare-outcome')).toHaveTextContent('declared · 3 machines · v1');
  });

  it('refuses a definition that is not a line before calling the server', async () => {
    render(<LineDeclarePanel initial={null} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Definition'), { target: { value: '{"siteId":"s"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Declare' }));
    expect(await screen.findByText('lineId is required.')).toHaveClass('text-status-error');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('edits a stored line with its version and says when the server refused', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('version 3 is behind 4', 409, {}));
    render(<LineDeclarePanel initial={stored} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('north · line-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Version')).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('declare-outcome')).toHaveTextContent('Someone changed this line first'));
    const body = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
    expect(body.version).toBe(3);
    expect(body.definition.machines[0]).toEqual({ machineId: 'print-01', process: 'print' });
  });

  it('retires only after a second confirmation', async () => {
    mocks.apiFetch.mockResolvedValue({});
    const onDone = vi.fn();
    render(<LineDeclarePanel initial={stored} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retire this line' }));
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('retire-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByTestId('retire-confirm')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retire this line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/machines/lines/north/line-1', { method: 'DELETE' });
  });
});
