import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServerName } from '../ServerName';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ServerName', () => {
  it('renders the server name', () => {
    renderWithRouter(<ServerName name="long-tail-knowledge" />);
    expect(screen.getByText('knowledge')).toBeDefined();
  });

  it('strips long-tail- prefix by default', () => {
    renderWithRouter(<ServerName name="long-tail-gmail" />);
    expect(screen.getByText('gmail')).toBeDefined();
  });

  it('shows full name when short=false', () => {
    renderWithRouter(<ServerName name="long-tail-gmail" short={false} />);
    expect(screen.getByText('long-tail-gmail')).toBeDefined();
  });

  it('renders a Server icon', () => {
    const { container } = renderWithRouter(<ServerName name="test" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders as a button when serverId is provided', () => {
    const { container } = renderWithRouter(<ServerName name="test" serverId="uuid-123" />);
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
  });

  it('renders as a span when no serverId', () => {
    const { container } = renderWithRouter(<ServerName name="test" />);
    const span = container.querySelector('span');
    expect(span).toBeTruthy();
    expect(container.querySelector('button')).toBeFalsy();
  });
});
