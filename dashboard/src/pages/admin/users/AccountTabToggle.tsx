import { User, Bot } from 'lucide-react';
import { SegmentedTabs } from '../../../components/common/layout/SegmentedTabs';

export type AccountTab = 'users' | 'service-accounts';

export function AccountTabToggle({ active, onChange }: { active: AccountTab; onChange: (t: AccountTab) => void }) {
  return (
    <SegmentedTabs<AccountTab>
      aria-label="Account kind"
      active={active}
      onChange={onChange}
      tabs={[
        { key: 'users', label: 'User Accounts', icon: <User className="w-3.5 h-3.5" /> },
        { key: 'service-accounts', label: 'Service Accounts', icon: <Bot className="w-3.5 h-3.5" /> },
      ]}
    />
  );
}
