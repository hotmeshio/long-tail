import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BindStepFields, payloadOf } from '../BindStepFields';

describe('bind step fields', () => {
  it('move is a toggle that leaves the other options as they are', () => {
    const onBind = vi.fn();
    const { rerender } = render(<BindStepFields bind={{ facet: 'serialNumber' }} onBind={onBind} />);
    fireEvent.click(screen.getByLabelText('Move a value bound elsewhere'));
    expect(onBind).toHaveBeenLastCalledWith({ facet: 'serialNumber', move: true });
    rerender(<BindStepFields bind={{ facet: 'serialNumber', move: true }} onBind={onBind} />);
    fireEvent.click(screen.getByLabelText('Move a value bound elsewhere'));
    expect(onBind).toHaveBeenLastCalledWith({ facet: 'serialNumber' });
  });

  it('resolving the held row shows its payload, and a JSON object is sent', () => {
    const onBind = vi.fn();
    const { rerender } = render(<BindStepFields bind={{}} onBind={onBind} />);
    expect(screen.queryByLabelText('Resolver payload')).toBeNull();
    fireEvent.click(screen.getByLabelText('Resolve the held row'));
    expect(onBind).toHaveBeenLastCalledWith({ resolve: {} });
    rerender(<BindStepFields bind={{ resolve: {} }} onBind={onBind} />);
    fireEvent.change(screen.getByLabelText('Resolver payload'), { target: { value: '{ "plateId": "{scan.target}" }' } });
    expect(onBind).toHaveBeenLastCalledWith({ resolve: { payload: { plateId: '{scan.target}' } } });
  });

  it('a payload that is not a JSON object is held back with a message', () => {
    const onBind = vi.fn();
    render(<BindStepFields bind={{ resolve: {} }} onBind={onBind} />);
    fireEvent.change(screen.getByLabelText('Resolver payload'), { target: { value: '[1, 2]' } });
    expect(onBind).not.toHaveBeenCalled();
    expect(screen.getByText(/Fix the JSON object/)).toBeTruthy();
  });

  it('reads payload text', () => {
    expect(payloadOf('')).toBeUndefined();
    expect(payloadOf('{"a":1}')).toEqual({ a: 1 });
    expect(payloadOf('nope')).toBeNull();
  });
});
