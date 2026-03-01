import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from '../Pagination';

describe('Pagination', () => {
  it('renders nothing when total is 0', () => {
    const { container } = render(
      <Pagination
        page={1}
        totalPages={0}
        onPageChange={vi.fn()}
        total={0}
        pageSize={10}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('displays range text', () => {
    render(
      <Pagination
        page={2}
        totalPages={4}
        onPageChange={vi.fn()}
        total={40}
        pageSize={10}
      />,
    );
    expect(screen.getByText(/11/)).toBeInTheDocument();
    expect(screen.getByText(/20/)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
  });

  it('calls onPageChange for Previous and Next', () => {
    const onChange = vi.fn();
    render(
      <Pagination
        page={2}
        totalPages={3}
        onPageChange={onChange}
        total={30}
        pageSize={10}
      />,
    );
    fireEvent.click(screen.getByText('Previous'));
    expect(onChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByText('Next'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('disables Previous on first page', () => {
    render(
      <Pagination
        page={1}
        totalPages={3}
        onPageChange={vi.fn()}
        total={30}
        pageSize={10}
      />,
    );
    expect(screen.getByText('Previous')).toBeDisabled();
  });

  it('disables Next on last page', () => {
    render(
      <Pagination
        page={3}
        totalPages={3}
        onPageChange={vi.fn()}
        total={30}
        pageSize={10}
      />,
    );
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('hides page navigation when totalPages is 1', () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        onPageChange={vi.fn()}
        total={5}
        pageSize={10}
      />,
    );
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('calls onPageSizeChange when page size selector changes', () => {
    const onSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        totalPages={2}
        onPageChange={vi.fn()}
        total={30}
        pageSize={10}
        onPageSizeChange={onSizeChange}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('10 / page'), {
      target: { value: '50' },
    });
    expect(onSizeChange).toHaveBeenCalledWith(50);
  });
});
