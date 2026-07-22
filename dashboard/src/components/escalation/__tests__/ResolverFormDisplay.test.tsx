import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

// Display-mode rendering: dictionary lists, 2×2 column groups, labels, and the
// help icon. Core input behavior lives in ResolverForm.test.tsx.

function formJson(fields: Record<string, unknown>, schema?: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...fields };
  if (schema) data._form_schema = schema;
  return JSON.stringify(data, null, 2);
}

describe('dictionary display', () => {
  const schema = {
    'x-lt-display': 'dictionary',
    properties: {
      po: { type: 'string', title: 'PO', readOnly: true },
      order_id: { type: 'string', readOnly: true },
      approved: { type: 'boolean' },
    },
  };

  it('renders consecutive read-only facts as one definition list', () => {
    const { container } = render(
      <ResolverForm value={formJson({ po: 'Hike Everyday', order_id: 'abc-123', approved: false }, schema)} onChange={vi.fn()} />,
    );
    const dl = container.querySelector('dl');
    expect(dl).not.toBeNull();
    expect(dl!.querySelectorAll('dt')).toHaveLength(2);
    expect(screen.getByText('Hike Everyday')).toBeInTheDocument();
    expect(screen.getByText('abc-123')).toBeInTheDocument();
    // The editable boolean keeps its checkbox
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('derives labels from title, then title-cased keys', () => {
    render(
      <ResolverForm value={formJson({ po: 'x', order_id: 'y', approved: false }, schema)} onChange={vi.fn()} />,
    );
    expect(screen.getByText('PO')).toBeInTheDocument();
    expect(screen.getByText('Order Id')).toBeInTheDocument();
  });

  it('keeps data-field-key on dictionary values for error focus', () => {
    const { container } = render(
      <ResolverForm value={formJson({ po: 'x', order_id: 'y', approved: false }, schema)} onChange={vi.fn()} />,
    );
    expect(container.querySelector('[data-field-key="po"]')).not.toBeNull();
  });

  it('renders empty values as an em dash and booleans as Yes/No', () => {
    const boolSchema = {
      'x-lt-display': 'dictionary',
      properties: {
        empty: { type: 'string', readOnly: true },
        flag: { type: 'boolean', readOnly: true },
      },
    };
    render(<ResolverForm value={formJson({ empty: '', flag: true }, boolSchema)} onChange={vi.fn()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });
});

describe('column groups (2×2)', () => {
  it('nests grouped fields in an inner two-column grid', () => {
    const schema = {
      'x-lt-layout': 'two-column',
      properties: {
        left_quantity: { type: 'number', 'x-lt-column-group': 'quantities' },
        right_quantity: { type: 'number', 'x-lt-column-group': 'quantities' },
        notes: { type: 'string' },
      },
    };
    const { container } = render(
      <ResolverForm value={formJson({ left_quantity: 1, right_quantity: 1, notes: '' }, schema)} onChange={vi.fn()} />,
    );
    const inner = container.querySelector('.grid.grid-cols-2');
    expect(inner).not.toBeNull();
    expect(inner!.querySelector('[data-field-key="left_quantity"]')).not.toBeNull();
    expect(inner!.querySelector('[data-field-key="right_quantity"]')).not.toBeNull();
    expect(inner!.querySelector('[data-field-key="notes"]')).toBeNull();
  });
});

describe('widget labeling', () => {
  it('a require-all checklist renders its label with the required asterisk', () => {
    const schema = {
      properties: {
        checks: {
          type: 'object',
          title: 'Fixed review',
          'x-lt-widget': 'checklist',
          'x-lt-source': 'envelope.checklist_items',
          'x-lt-require-all': true,
        },
      },
    };
    render(
      <ResolverForm
        value={formJson({ checks: {} }, schema)}
        onChange={vi.fn()}
        escalationContext={{
          escalation: null,
          metadata: null,
          envelope: { checklist_items: [{ id: 'a', label: 'Confirm the piece is clean' }] } as unknown as Record<string, unknown>,
          payload: null,
          resolver: null,
        }}
      />,
    );
    const label = screen.getByText('Fixed review');
    expect(label.textContent).toContain('*');
  });
});

describe('object-typed widget values', () => {
  const chipSchema = {
    properties: {
      reasons: {
        type: 'object',
        title: 'What went wrong',
        'x-lt-widget': 'checklist',
        'x-lt-source': 'envelope.reject_reason_items',
        'x-lt-variant': 'chips',
      },
    },
  };
  const ctx = {
    escalation: null,
    metadata: null,
    envelope: { reject_reason_items: [{ id: 'warping', label: 'Warping' }] } as unknown as Record<string, unknown>,
    payload: null,
    resolver: null,
  };

  it('a chip click stores an object even when the value arrives as a string', () => {
    const onChange = vi.fn();
    render(
      <ResolverForm
        value={formJson({ reasons: '' }, chipSchema)}
        onChange={onChange}
        escalationContext={ctx}
      />,
    );
    fireEvent.click(screen.getByTestId('checklist-item-warping'));
    const emitted = JSON.parse(onChange.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(emitted.reasons).toEqual({ warping: true });
  });

  it('a string-stuck value renders its selections and heals on the next click', () => {
    const onChange = vi.fn();
    render(
      <ResolverForm
        value={formJson({ reasons: '{"warping":true}' }, chipSchema)}
        onChange={onChange}
        escalationContext={ctx}
      />,
    );
    expect(screen.getByTestId('checklist-item-warping')).toBeChecked();
    fireEvent.click(screen.getByTestId('checklist-item-warping'));
    const emitted = JSON.parse(onChange.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(emitted.reasons).toEqual({ warping: false });
  });
});

describe('help icon', () => {
  it('opens instructions when the schema carries x-lt-help', () => {
    const onOpenHelp = vi.fn();
    render(
      <ResolverForm
        value={formJson({ notes: '' }, { title: 'QA', 'x-lt-help': '### Steps', properties: { notes: { type: 'string' } } })}
        onChange={vi.fn()}
        onOpenHelp={onOpenHelp}
      />,
    );
    fireEvent.click(screen.getByLabelText('Open instructions'));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it('renders no help icon without authored help', () => {
    render(
      <ResolverForm
        value={formJson({ notes: '' }, { title: 'QA', properties: { notes: { type: 'string' } } })}
        onChange={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Open instructions')).toBeNull();
  });
});
