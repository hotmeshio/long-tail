import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SchemeMatchFields, patternLines, patternsValid } from '../SchemeMatchFields';

describe('pattern text helpers', () => {
  it('reads one trimmed expression per non-empty line', () => {
    expect(patternLines(' 1Z[0-9A-Z]{16} \n\n[0-9]{12}\n')).toEqual(['1Z[0-9A-Z]{16}', '[0-9]{12}']);
  });

  it('is valid with at least one line and every line compiling', () => {
    expect(patternsValid('1Z[0-9A-Z]{16}')).toBe(true);
    expect(patternsValid('')).toBe(false);
    expect(patternsValid('1Z.+\n[')).toBe(false);
  });
});

const props = {
  encoding: 'pattern', isIdentity: false, targetMatch: 'value' as const, onTargetMatch: vi.fn(),
  patternsText: '', onPatternsText: vi.fn(), precedesGtin: null, onPrecedesGtin: vi.fn(),
};

describe('SchemeMatchFields', () => {
  it('shows the patterns and gtin order for a pattern scheme, and names an expression that does not compile', () => {
    render(<SchemeMatchFields {...props} patternsText={'1Z.+\n['} />);
    expect(screen.getByText('Patterns')).toBeInTheDocument();
    expect(screen.getByText('Digits-only codes')).toBeInTheDocument();
    expect(screen.getByText(/Not a valid expression: \[/)).toBeInTheDocument();
  });

  it('reports the target match and gtin order the operator picks', () => {
    const onTargetMatch = vi.fn();
    const onPrecedesGtin = vi.fn();
    render(<SchemeMatchFields {...props} onTargetMatch={onTargetMatch} onPrecedesGtin={onPrecedesGtin} />);
    fireEvent.change(screen.getByDisplayValue('One value'), { target: { value: 'member' } });
    fireEvent.change(screen.getByDisplayValue('Not declared'), { target: { value: 'pattern' } });
    fireEvent.change(screen.getByDisplayValue('Not declared'), { target: { value: 'gtin' } });
    expect(onTargetMatch).toHaveBeenCalledWith('member');
    expect(onPrecedesGtin).toHaveBeenNthCalledWith(1, true);
    expect(onPrecedesGtin).toHaveBeenNthCalledWith(2, false);
  });

  it('an identity scheme with another encoding shows neither field', () => {
    render(<SchemeMatchFields {...props} encoding="delimited" isIdentity />);
    expect(screen.queryByText('Target holds')).not.toBeInTheDocument();
    expect(screen.queryByText('Patterns')).not.toBeInTheDocument();
  });
});
