import { User, Bot } from 'lucide-react';

export type AccountTab = 'users' | 'service-accounts';

export function AccountTabToggle({ active, onChange }: { active: AccountTab; onChange: (t: AccountTab) => void }) {
  const btn = (tab: AccountTab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(tab)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
        active === tab
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex gap-1 p-0.5 bg-surface-sunken rounded-lg w-fit">
      {btn('users', <User className="w-3.5 h-3.5" />, 'User Accounts')}
      {btn('service-accounts', <Bot className="w-3.5 h-3.5" />, 'Service Accounts')}
    </div>
  );
}
