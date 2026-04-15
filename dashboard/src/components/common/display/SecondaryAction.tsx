import type { LucideIcon } from 'lucide-react';

interface SecondaryActionProps {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function SecondaryAction({ icon: Icon, label, onClick, disabled }: SecondaryActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />}
      {label}
    </button>
  );
}
