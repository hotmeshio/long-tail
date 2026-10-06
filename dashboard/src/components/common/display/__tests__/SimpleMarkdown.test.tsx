import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SimpleMarkdown } from '../SimpleMarkdown';

describe('SimpleMarkdown', () => {
  it('sets its own small size and secondary tone by default and when compact', () => {
    const { container: normal } = render(<SimpleMarkdown content="Hello **there**" />);
    expect(normal.querySelector('p')?.className).toContain('text-sm');
    expect(normal.querySelector('p')?.className).toContain('text-text-secondary');
    const { container: compact } = render(<SimpleMarkdown content="Hello" compact />);
    expect(compact.querySelector('p')?.className).toContain('text-xs');
  });

  it('inherit takes the surrounding size and tone, for large display copy', () => {
    const { container } = render(<div className="text-4xl"><SimpleMarkdown content="Drop it in **SF-A-2**." inherit /></div>);
    const p = container.querySelector('p')!;
    expect(p.className).not.toMatch(/text-(xs|sm)|text-text-secondary/);
    expect(p.innerHTML).toBe('Drop it in <strong>SF-A-2</strong>.');
  });
});
