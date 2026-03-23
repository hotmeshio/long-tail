/**
 * Consistent heading for each wizard panel: a title and optional subtitle.
 */
export function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-light text-text-primary">{title}</h2>
      {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
    </div>
  );
}
