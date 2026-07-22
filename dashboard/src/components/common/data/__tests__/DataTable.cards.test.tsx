import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable, partitionColumns, type Column } from '../DataTable';

// Console-card fold: a table row IS a dictionary. jsdom evaluates neither
// container queries nor ResizeObserver, so card mode is exercised via
// forceCardMode and the geometry classes are asserted as plumbing.

interface Row { id: string; name: string; role: string; age: string; extra: string }

const ROWS: Row[] = [
  { id: 'a', name: 'Final QA — ACME-1042', role: 'acme-final-qa', age: '5m', extra: 'x' },
  { id: 'b', name: 'Addons — ACME-1042', role: 'acme-addons', age: '9m', extra: 'y' },
];

const COLUMNS: Column<Row>[] = [
  { key: 'name', label: 'Summary', render: (r) => <span>{r.name}</span>, priority: 1 },
  { key: 'role', label: 'Role', render: (r) => <span>{r.role}</span>, priority: 2 },
  { key: 'age', label: 'Ago', render: (r) => <span>{r.age}</span>, className: 'w-12', priority: 1 },
  { key: 'extra', label: 'Extra', render: (r) => <span>{r.extra}</span>, priority: 3 },
];

describe('partitionColumns', () => {
  it('splits by declared priorities in order', () => {
    const { identity, meta, dropped } = partitionColumns(COLUMNS);
    expect(identity.map((c) => c.key)).toEqual(['name', 'age']);
    expect(meta.map((c) => c.key)).toEqual(['role']);
    expect(dropped.map((c) => c.key)).toEqual(['extra']);
  });

  it('defaults to first-column identity when nothing is declared', () => {
    const cols = COLUMNS.map(({ priority: _p, ...c }) => c as Column<Row>);
    const { identity, meta, dropped } = partitionColumns(cols);
    expect(identity.map((c) => c.key)).toEqual(['name']);
    expect(meta.map((c) => c.key)).toEqual(['role', 'age', 'extra']);
    expect(dropped).toEqual([]);
  });

  it('undeclared columns fold when any column declares a priority', () => {
    const cols: Column<Row>[] = [
      { key: 'name', label: 'Summary', render: (r) => <span>{r.name}</span> },
      { key: 'age', label: 'Ago', render: (r) => <span>{r.age}</span>, priority: 1 },
    ];
    const { identity, meta } = partitionColumns(cols);
    expect(identity.map((c) => c.key)).toEqual(['age']);
    expect(meta.map((c) => c.key)).toEqual(['name']);
  });
});

describe('DataTable card mode', () => {
  it('renders cards: identity on the title line, meta as pairs, dropped absent', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={ROWS} keyFn={(r) => r.id} forceCardMode />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Final QA — ACME-1042')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    // Meta pairs render label + value in a dictionary
    const dl = container.querySelector('dl');
    expect(dl).not.toBeNull();
    expect(dl!.textContent).toContain('Role');
    expect(dl!.textContent).toContain('acme-final-qa');
    // Priority 3 dropped
    expect(screen.queryByText('x')).toBeNull();
    expect(screen.queryByText('Extra')).toBeNull();
  });

  it('fires onRowClick from a card and marks the active row', () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <DataTable columns={COLUMNS} data={ROWS} keyFn={(r) => r.id} forceCardMode onRowClick={onRowClick} activeRowKey="b" />,
    );
    fireEvent.click(screen.getByText('Addons — ACME-1042'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
    const active = container.querySelector('.border-l-accent');
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain('Addons');
  });

  it('renders the compact sort control when sortable columns and onSort exist', () => {
    const cols = COLUMNS.map((c) => (c.key === 'age' ? { ...c, sortable: true } : c));
    const onSort = vi.fn();
    render(
      <DataTable columns={cols} data={ROWS} keyFn={(r) => r.id} forceCardMode onSort={onSort} sort={{ sort_by: 'age', order: 'desc' }} />,
    );
    expect(screen.getByText('Sort')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Flip sort direction'));
    expect(onSort).toHaveBeenCalledWith('age');
  });

  it('table mode carries the @container/table wrapper and renders a table by default', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={ROWS} keyFn={(r) => r.id} />,
    );
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('[class*="@container/table"]')).not.toBeNull();
  });
});
