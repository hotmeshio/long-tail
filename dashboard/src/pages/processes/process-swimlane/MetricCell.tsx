/** Small labeled metric cell used inside detail panels */
export function MetricCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">
        {label}
      </p>
      <div className="text-xs text-text-primary">{children}</div>
    </div>
  );
}
