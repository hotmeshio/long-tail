export function EmptyState({
  title = 'No data',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-sm text-text-secondary">{title}</p>
      {description && (
        <p className="text-xs text-text-tertiary mt-1">{description}</p>
      )}
    </div>
  );
}
