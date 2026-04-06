import { Pagination } from './Pagination';

interface StickyPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
}

export function StickyPagination(props: StickyPaginationProps) {
  if (props.total === 0) return null;

  return (
    <div className="sticky bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-10 px-10 pt-2 pb-4" style={{ bottom: 'calc(var(--feed-height, 0px) - 8px)' }}>
      <Pagination {...props} />
    </div>
  );
}
