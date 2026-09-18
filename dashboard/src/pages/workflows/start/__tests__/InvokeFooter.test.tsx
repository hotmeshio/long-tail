import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventContext } from '../../../../hooks/useEventContext';
import { InvokeFooter } from '../InvokeFooter';

function renderFooter(props: Partial<Parameters<typeof InvokeFooter>[0]> = {}, connected = true) {
  const onSubmit = vi.fn();
  const onSubmitAgain = vi.fn();
  render(
    <EventContext.Provider value={{ connected, subscribe: () => () => {} }}>
      <MemoryRouter>
        <InvokeFooter onSubmit={onSubmit} onSubmitAgain={onSubmitAgain} pending={false} error={null} startedId={null} executionPath={null} {...props} />
      </MemoryRouter>
    </EventContext.Provider>,
  );
  return { onSubmit, onSubmitAgain };
}

describe('InvokeFooter', () => {
  it('a regular Submit button, armed until a run starts', () => {
    const { onSubmit } = renderFooter();
    const button = screen.getByTestId('invoke-start');
    expect(button).toHaveTextContent('Submit');
    expect(button.className).not.toContain('w-full');
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.queryByTestId('invoke-again')).not.toBeInTheDocument();
  });

  it('a started run replaces Submit with "Submit again" until the person chooses it', () => {
    const { onSubmitAgain } = renderFooter({ startedId: 'wf-1' });
    expect(screen.queryByTestId('invoke-start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('invoke-again'));
    expect(onSubmitAgain).toHaveBeenCalled();
  });

  it('warns and offers a reconnect while live events are off', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
    renderFooter({}, false);
    expect(screen.getByTestId('events-warning')).toHaveTextContent('Live events are off');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect events' }));
    expect(reload).toHaveBeenCalled();
  });

  it('stays quiet about events while connected', () => {
    renderFooter({}, true);
    expect(screen.queryByTestId('events-warning')).not.toBeInTheDocument();
  });
});

describe('InvokeFooter in a dialog', () => {
  it('sits in the flow instead of sticking to the shell scroll', () => {
    renderFooter({ host: 'modal' });
    const footer = screen.getByTestId('invoke-start').closest('div.border-t')!;
    expect(footer.className).not.toContain('sticky');
    expect(footer.className).not.toContain('-mb-16');
  });
});
