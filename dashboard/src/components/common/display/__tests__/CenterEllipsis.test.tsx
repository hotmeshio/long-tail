import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CenterEllipsis } from '../CenterEllipsis';

describe('CenterEllipsis', () => {
  it('renders a short value whole, as a single text node', () => {
    render(<CenterEllipsis text="SN-1" tail={6} />);
    // getByText matches the value intact — no head/tail split.
    expect(screen.getByText('SN-1')).toBeInTheDocument();
  });

  it('pins the trailing characters that disambiguate one id from the next', () => {
    render(<CenterEllipsis text="solo-MOCKSOLOP1S0000002" tail={6} />);
    // The last `tail` chars are kept in their own non-shrinking node.
    expect(screen.getByText('000002')).toBeInTheDocument();
  });

  it('exposes the full value as the hover title', () => {
    render(<CenterEllipsis text="solo-MOCKSOLOP1S0000002" tail={6} />);
    expect(screen.getByTitle('solo-MOCKSOLOP1S0000002')).toBeInTheDocument();
  });
});
