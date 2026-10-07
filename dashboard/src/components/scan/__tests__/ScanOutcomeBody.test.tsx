import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScanOutcomeBody } from '../ScanOutcomeBody';

const result = (response: any) => ({ code: '14:0:SF-A-2', source: 'keyboard-wedge', at: 0, error: null, navigated: false, response }) as any;

describe('ScanOutcomeBody', () => {
  it('renders a refusal once, as markdown', () => {
    const markdown = 'That is tub SF-A-2. This bag goes in **SF-A-1**.';
    const { container } = render(<ScanOutcomeBody result={result({ outcome: 'refused', refusal: { markdown }, error: markdown })} />);
    expect(container.textContent?.match(/This bag goes in/g)).toHaveLength(1);
    expect(container.textContent).not.toContain('**');
    expect(screen.getByText('SF-A-1').tagName).toBe('STRONG');
  });

  it('keeps an error line that says something the markdown does not', () => {
    render(<ScanOutcomeBody result={result({ outcome: 'not_primed', error: 'an acting identity is required', notPrimed: { markdown: 'Scan your badge.' } })} />);
    expect(screen.getByText('an acting identity is required')).toBeInTheDocument();
    expect(screen.getByText('Scan your badge.')).toBeInTheDocument();
  });

  it('a stale subject says why once', () => {
    const { container } = render(<ScanOutcomeBody result={result({ outcome: 'subject_stale', error: 'The held item moved on.' })} />);
    expect(container.textContent?.match(/moved on/g)).toHaveLength(1);
  });

  it('a transport failure shows the error', () => {
    render(<ScanOutcomeBody result={{ ...result(undefined), error: 'Network down' }} />);
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});
