import { render, screen } from '@testing-library/react';
import { Collapsible } from '../layout/Collapsible';

describe('Collapsible', () => {
  it('renders children when open', () => {
    render(
      <Collapsible open={true}>
        <p>Visible content</p>
      </Collapsible>,
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });

  it('does not render children when initially closed', () => {
    render(
      <Collapsible open={false}>
        <p>Hidden content</p>
      </Collapsible>,
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('applies collapsed grid class when closed', () => {
    const { container } = render(
      <Collapsible open={false}>
        <p>Content</p>
      </Collapsible>,
    );
    expect(container.firstChild).toHaveClass('grid-rows-[0fr]');
  });

  it('applies expanded grid class when open', () => {
    const { container } = render(
      <Collapsible open={true}>
        <p>Content</p>
      </Collapsible>,
    );
    expect(container.firstChild).toHaveClass('grid-rows-[1fr]');
  });
});
