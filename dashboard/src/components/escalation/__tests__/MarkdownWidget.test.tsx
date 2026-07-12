import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MarkdownWidget } from '../widgets/MarkdownWidget';
import { ResolverForm } from '../ResolverForm';

const SOURCE = '### Checklist\n\nConfirm the **legal name** matches.';

describe('MarkdownWidget', () => {
  it('readOnly renders the markdown source as HTML with no input chrome', () => {
    const { container } = render(
      <MarkdownWidget
        fieldKey="review_guide"
        value={SOURCE}
        onChange={vi.fn()}
        schema={{ readOnly: true }}
      />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Checklist');
    expect(container.querySelector('strong')?.textContent).toBe('legal name');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('editable shows a Write textarea and a rendered Preview toggle', () => {
    const { container } = render(
      <MarkdownWidget fieldKey="notes_md" value={SOURCE} onChange={vi.fn()} schema={{}} />,
    );
    expect(container.querySelector('textarea')?.value).toBe(SOURCE);

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Checklist');

    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(container.querySelector('textarea')?.value).toBe(SOURCE);
  });

  it('edits emit the markdown source', () => {
    const onChange = vi.fn();
    render(<MarkdownWidget fieldKey="notes_md" value="" onChange={onChange} schema={{}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Title' } });
    expect(onChange).toHaveBeenCalledWith('# Title');
  });
});

describe('ResolverForm — markdown content block', () => {
  it('renders a readOnly markdown field as HTML, not static text', () => {
    const json = JSON.stringify({
      review_guide: SOURCE,
      _form_schema: {
        properties: {
          review_guide: { type: 'string', readOnly: true, 'x-lt-widget': 'markdown' },
        },
      },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('h3')?.textContent).toBe('Checklist');
    expect(screen.queryByText(SOURCE)).toBeNull(); // raw source is not shown
  });
});
