import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChecklistWidget } from '../widgets/ChecklistWidget';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

const ITEMS = [
  { id: 'item_0', label: 'Step 1: Confirm action 1' },
  { id: 'item_1', label: 'Step 2: Confirm action 2' },
  { id: 'item_2', label: 'Step 3: Confirm action 3' },
];

function makeContext(items = ITEMS): ShowIfContext {
  return {
    escalation: null,
    metadata: null,
    envelope: { checklist_items: items } as unknown as Record<string, unknown>,
    payload: null,
    resolver: null,
  };
}

describe('ChecklistWidget', () => {
  it('renders empty state when no escalation context is provided', () => {
    render(<ChecklistWidget fieldKey="items" value="" onChange={vi.fn()} />);
    expect(screen.getByText(/no checklist items/i)).toBeInTheDocument();
  });

  it('renders empty state when source path resolves to nothing', () => {
    const ctx = makeContext([]);
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    expect(screen.getByText(/no checklist items/i)).toBeInTheDocument();
  });

  it('renders one checkbox per item from the source path', () => {
    const ctx = makeContext();
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    ITEMS.forEach((item) => {
      expect(screen.getByTestId(`checklist-item-${item.id}`)).toBeInTheDocument();
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });

  it('starts all checkboxes unchecked when value is empty', () => {
    const ctx = makeContext();
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
  });

  it('reflects checked state from JSON value prop', () => {
    const ctx = makeContext();
    const value = JSON.stringify({ item_0: true, item_1: false, item_2: true });
    render(
      <ChecklistWidget
        fieldKey="items"
        value={value}
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    expect(screen.getByTestId('checklist-item-item_0')).toBeChecked();
    expect(screen.getByTestId('checklist-item-item_1')).not.toBeChecked();
    expect(screen.getByTestId('checklist-item-item_2')).toBeChecked();
  });

  it('calls onChange with updated JSON when a checkbox is toggled', () => {
    const ctx = makeContext();
    const onChange = vi.fn();
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={onChange}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    fireEvent.click(screen.getByTestId('checklist-item-item_0'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as Record<string, boolean>;
    expect(parsed['item_0']).toBe(true);
  });

  it('shows "X / N confirmed" counter reflecting current state', () => {
    const ctx = makeContext();
    const value = JSON.stringify({ item_0: true, item_1: true, item_2: false });
    render(
      <ChecklistWidget
        fieldKey="items"
        value={value}
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
      />,
    );
    expect(screen.getByText('2 / 3 confirmed')).toBeInTheDocument();
  });

  it('does NOT show "at least one required" hint before a submit attempt', () => {
    const ctx = makeContext();
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
        isRequired
        submitAttempted={false}
      />,
    );
    expect(screen.queryByText(/at least one required/i)).not.toBeInTheDocument();
  });

  it('shows "at least one required" hint after a submit attempt when nothing is checked', () => {
    const ctx = makeContext();
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
        isRequired
        submitAttempted
      />,
    );
    expect(screen.getByText(/at least one required/i)).toBeInTheDocument();
  });

  it('highlights all unchecked items when isRequired fails (none checked after submit)', () => {
    const items = [
      { id: 'a', label: 'Required item', required: true },
      { id: 'b', label: 'Optional item', required: false },
    ];
    const ctx = makeContext(items);
    render(
      <ChecklistWidget
        fieldKey="checks"
        value={JSON.stringify({ a: false, b: false })}
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
        isRequired
        submitAttempted
      />,
    );
    // Both items unchecked and group requires at least one — both should indicate error
    expect(screen.getByText('Required item').className).toContain('text-status-error');
    expect(screen.getByText('Optional item').className).toContain('text-status-error');
  });

  it('clears all per-item error highlights once at least one item is checked', () => {
    const items = [
      { id: 'a', label: 'Required item', required: true },
      { id: 'b', label: 'Optional item', required: false },
    ];
    const ctx = makeContext(items);
    render(
      <ChecklistWidget
        fieldKey="checks"
        value={JSON.stringify({ a: true, b: false })}
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
        isRequired
        submitAttempted
      />,
    );
    // 'a' is checked — group requirement met, no item should show error
    expect(screen.getByText('Required item').className).not.toContain('text-status-error');
    expect(screen.getByText('Optional item').className).not.toContain('text-status-error');
  });

  it('highlights individually-required items when isRequired is false and none are checked', () => {
    const items = [
      { id: 'a', label: 'Must confirm', required: true },
      { id: 'b', label: 'Optional step', required: false },
    ];
    const ctx = makeContext(items);
    render(
      <ChecklistWidget
        fieldKey="checks"
        value={JSON.stringify({ a: false, b: false })}
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.checklist_items' }}
        escalationContext={ctx}
        isRequired={false}
        submitAttempted
      />,
    );
    expect(screen.getByText('Must confirm').className).toContain('text-status-error');
    expect(screen.getByText('Optional step').className).not.toContain('text-status-error');
  });

  it('reads from a nested source path within a domain', () => {
    const ctx: ShowIfContext = {
      escalation: null,
      metadata: null,
      envelope: { nested: { deep: ITEMS } } as unknown as Record<string, unknown>,
      payload: null,
      resolver: null,
    };
    render(
      <ChecklistWidget
        fieldKey="items"
        value=""
        onChange={vi.fn()}
        schema={{ 'x-lt-source': 'envelope.nested.deep' }}
        escalationContext={ctx}
      />,
    );
    expect(screen.getByTestId('checklist-item-item_0')).toBeInTheDocument();
  });
});
