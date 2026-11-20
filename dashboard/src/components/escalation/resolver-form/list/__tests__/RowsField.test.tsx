import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FieldRow } from '../../FieldRow';

const lines = {
  type: ['array', 'null'],
  title: 'Order lines',
  minItems: 1,
  maxItems: 3,
  'x-lt-add-label': 'Add a line',
  items: {
    type: 'object',
    required: ['code', 'qty'],
    'x-lt-order': ['code', 'qty', 'side'],
    properties: {
      code: { type: 'string', title: 'HCPCS', pattern: '^A[0-9]{4}$' },
      qty: { type: 'integer', title: 'Qty', minimum: 1, default: 1 },
      side: { type: 'string', title: 'Side', enum: ['left', 'right'] },
      detail: { type: 'string', title: 'Detail', 'x-lt-showIf': 'row.side=left' },
      locked: { type: 'string', title: 'Source', readOnly: true },
    },
  },
};
const draw = (value: unknown, extra: Record<string, unknown> = {}, onChange = vi.fn(), locked = false) => {
  const schema = { properties: { lines: { ...lines, ...extra } } };
  render(<FieldRow fieldKey="lines" value={value as any} onChange={onChange} schema={schema} locked={locked} />);
  return onChange;
};
const rowsOf = () => screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row'));

describe('rows for a list of objects', () => {
  it('draws a table with a header per column in x-lt-order and a row per item', () => {
    draw([{ code: 'A5500', qty: 2, side: 'left' }, { code: 'A5501', qty: 1 }]);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['HCPCS*', 'Qty*', 'Side', 'Detail', 'Source', 'Row actions']);
    expect(rowsOf()).toHaveLength(2);
    expect((document.getElementById('lt-field-lines.0.code') as HTMLInputElement).value).toBe('A5500');
  });

  it('edits one cell and keeps the other cells and undeclared properties of the row', () => {
    const onChange = draw([{ code: 'A5500', qty: 2, extra: { keep: true } }]);
    fireEvent.change(document.getElementById('lt-field-lines.0.code')!, { target: { value: 'A5501' } });
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5501', qty: 2, extra: { keep: true } }]);
  });

  it('shows a cell error on the cell, tied by aria-describedby', () => {
    draw([{ code: 'A5500', qty: 0 }]);
    const qty = document.getElementById('lt-field-lines.0.qty')!;
    const error = document.getElementById(qty.getAttribute('aria-describedby')!)!;
    expect(error.textContent).toBe('Minimum value is 1');
  });

  it('adds a row from property defaults and names the add control from x-lt-add-label', () => {
    const onChange = draw([{ code: 'A5500', qty: 2 }]);
    fireEvent.click(screen.getByRole('button', { name: /Add a line/ }));
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5500', qty: 2 }, { qty: 1 }]);
  });

  it('disables add at maxItems and remove at minItems with the reason', () => {
    draw([{ code: 'A5500', qty: 1 }, { code: 'A5501', qty: 1 }, { code: 'A5502', qty: 1 }]);
    const add = screen.getByRole('button', { name: /Add a line/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('At most 3 rows');
  });

  it('will not remove the last row below minItems', () => {
    draw([{ code: 'A5500', qty: 1 }]);
    const remove = screen.getByRole('button', { name: 'Remove Order lines row 1' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.title).toBe('At least 1 rows');
  });

  it('removes and duplicates a row', () => {
    const onChange = draw([{ code: 'A5500', qty: 1 }, { code: 'A5501', qty: 1 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Order lines row 1' }));
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'A5501', qty: 1 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Order lines row 2' }));
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'A5500', qty: 1 }, { code: 'A5501', qty: 1 }, { code: 'A5501', qty: 1 }]);
  });

  it('shows reorder controls only when sortable', () => {
    draw([{ code: 'A5500', qty: 1 }, { code: 'A5501', qty: 1 }]);
    expect(screen.queryByRole('button', { name: /Move Order lines row/ })).toBeNull();
  });

  it('moves rows when sortable', () => {
    const onChange = draw([{ code: 'A5500', qty: 1 }, { code: 'A5501', qty: 1 }], { 'x-lt-sortable': true });
    fireEvent.click(screen.getByRole('button', { name: 'Move Order lines row 1 down' }));
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5501', qty: 1 }, { code: 'A5500', qty: 1 }]);
  });

  it('reads the row in a cell showIf', () => {
    draw([{ code: 'A5500', qty: 1, side: 'right' }, { code: 'A5501', qty: 1, side: 'left' }]);
    expect(document.getElementById('lt-field-lines.0.detail')).toBeNull();
    expect(document.getElementById('lt-field-lines.1.detail')).not.toBeNull();
  });

  it('locks a readOnly column', () => {
    draw([{ code: 'A5500', qty: 1, locked: 'extractor' }]);
    expect(document.getElementById('lt-field-lines.0.locked')).toBeNull();
    expect(screen.getByText('extractor')).toBeTruthy();
  });

  it('Enter in the last cell of the last row adds a row; Alt+Delete removes the row', () => {
    const onChange = draw([{ code: 'A5500', qty: 1 }], { minItems: undefined });
    const lastCell = document.getElementById('lt-field-lines.0.side') as HTMLElement;
    fireEvent.keyDown(lastCell, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith([{ code: 'A5500', qty: 1 }, { qty: 1 }]);
    fireEvent.keyDown(document.getElementById('lt-field-lines.0.code')!, { key: 'Delete', altKey: true });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Escape restores the cell to what it held when focus entered', () => {
    const onChange = draw([{ code: 'A5500', qty: 1 }]);
    const code = document.getElementById('lt-field-lines.0.code')!;
    fireEvent.focus(code);
    fireEvent.keyDown(code, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5500', qty: 1 }]);
  });

  it('fills cells from pasted tab-separated rows', () => {
    const onChange = draw([{ code: 'A5500', qty: 1 }]);
    fireEvent.paste(document.getElementById('lt-field-lines.0.code')!, { clipboardData: { getData: () => 'A5501\t3\nA5502\t4' } });
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5501', qty: 3 }, { code: 'A5502', qty: 4 }]);
  });

  it('a null list reads "Not stated" with an add control; a locked form hides the controls', () => {
    draw(null);
    expect(screen.getByText('Not stated')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add a line/ })).toBeTruthy();
  });

  it('shows the table read-only, with no controls, when the form is locked', () => {
    draw([{ code: 'A5500', qty: 2 }], {}, vi.fn(), true);
    expect(screen.queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('table')).getByText('A5500')).toBeTruthy();
  });
});

describe('review key landing', () => {
  it('focuses the first cell when the key lands on the list', () => {
    draw([{ code: 'A5500', qty: 1 }]);
    const group = document.querySelector('[data-field-key="lines"]') as HTMLElement;
    group.focus();
    expect(document.activeElement).toBe(document.getElementById('lt-field-lines.0.code'));
  });
});

describe('number cells', () => {
  it('a cleared number cell is empty, not zero, so the row can read as untouched', () => {
    const onChange = draw([{ code: 'A5500', qty: 3 }], { minItems: undefined });
    fireEvent.change(document.getElementById('lt-field-lines.0.qty')!, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith([{ code: 'A5500', qty: '' }]);
  });
});
