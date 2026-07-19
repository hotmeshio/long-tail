import { Bot, UserCircle } from 'lucide-react';
import { BotPicker } from '../../../components/common/form/BotPicker';
import { useAuth } from '../../../hooks/useAuth';
import type { LTWorkflowConfig } from '../../../api/types';

export function IdentitySummary({
  config,
  overrideBot,
  onOverrideChange,
  showOverride,
}: {
  config: LTWorkflowConfig;
  overrideBot?: string;
  onOverrideChange?: (botExternalId: string) => void;
  showOverride?: boolean;
}) {
  const { user } = useAuth();
  const effectiveBot = overrideBot || config.execute_as;

  return (
    <div className="bg-surface-sunken rounded-lg px-4 py-3 space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Running as</span>
          {effectiveBot && !overrideBot && (
            <span className="text-[9px] text-text-tertiary">configured default</span>
          )}
          {overrideBot && (
            <span className="text-[9px] text-accent">admin override</span>
          )}
        </div>
        {/* Read-only identity, styled as a field so it reads consistently with
            the Override control below and pops off the sunken band. */}
        <div className="field flex items-center gap-1.5">
          {effectiveBot ? (
            <>
              <Bot className="w-3.5 h-3.5 text-accent/70 shrink-0" />
              <span className="text-xs text-text-primary font-mono">{effectiveBot}</span>
            </>
          ) : (
            <>
              <UserCircle className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              <span className="text-xs text-text-primary">
                {user?.displayName || user?.username || 'you'}
              </span>
            </>
          )}
        </div>
      </div>
      {showOverride && onOverrideChange && (
        <div>
          <label className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">Override identity</label>
          <BotPicker
            selected={overrideBot ?? ''}
            onChange={onOverrideChange}
            placeholder={config.execute_as ? `Default: ${config.execute_as}` : 'Invoking user (default)'}
          />
        </div>
      )}
    </div>
  );
}
