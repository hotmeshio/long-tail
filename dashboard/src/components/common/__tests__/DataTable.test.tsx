import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type Column } from '../data/DataTable';

interface TestRow {
  id: string;
  name: string;
}

const columns: Column<TestRow>[] = [
  { key: 'id', label: 'ID', render: (r) => r.id },
  { key: 'name', label: 'Name', render: (r) => r.name },
];

const rows: TestRow[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

describe('DataTable', () => {
  it('renders column headers and row data', () => {
    render(<DataTable columns={columns} data={rows} keyFn={(r) => r.id} />);
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading is true', () => {
    const { container } = render(
      <DataTable columns={columns} data={[]} keyFn={(r) => r.id} isLoading />,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('ID')).not.toBeInTheDocument();
  });

  it('shows empty state when data is empty', () => {
    render(<DataTable columns={columns} data={[]} keyFn={(r) => r.id} />);
    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyFn={(r) => r.id}
        emptyMessage="Nothing to see"
      />,
    );
    expect(screen.getByText('Nothing to see')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        keyFn={(r) => r.id}
        onRowClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(onClick).toHaveBeenCalledWith(rows[0]);
  });
});

describe('DataTable — fold policy and density', () => {
  const prioritized: Column<TestRow>[] = [
    { key: 'id', label: 'ID', render: (r) => r.id, priority: 1 },
    { key: 'name', label: 'Name', render: (r) => r.name, priority: 2 },
  ];

  it('fold="always" renders console cards without a header row', () => {
    render(<DataTable columns={prioritized} data={rows} keyFn={(r) => r.id} fold="always" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('fold="never" keeps the table; compact density tightens cells and holds non-identity columns for the split width', () => {
    render(<DataTable columns={prioritized} data={rows} keyFn={(r) => r.id} fold="never" density="compact" />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    const idHeader = screen.getByText('ID').closest('th')!;
    const nameHeader = screen.getByText('Name').closest('th')!;
    expect(idHeader.className).toContain('py-1.5');
    expect(idHeader.className).not.toContain('hidden');
    expect(nameHeader.className).toContain('hidden @split/table:table-cell');
    expect(screen.getByText('Alice').closest('td')!.className).toContain('text-xs');
  });

  it('default density shows every column at full padding', () => {
    render(<DataTable columns={prioritized} data={rows} keyFn={(r) => r.id} fold="never" />);
    expect(screen.getByText('Name').closest('th')!.className).not.toContain('hidden');
    expect(screen.getByText('ID').closest('th')!.className).toContain('py-3');
  });
});
