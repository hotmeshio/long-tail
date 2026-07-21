import { BookOpen } from 'lucide-react';
import type { AgentFormState } from './agent-form-types';
import { labelCls, hintCls, inputCls } from './agent-form-types';

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function IdentityStep({ form, set }: Props) {
  return (
    <div className="space-y-8">
      <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between">
        <p className="text-xs text-text-secondary italic leading-relaxed">
          Give your automation a name and describe what it does. The name appears everywhere — in events, logs, and the dashboard.
        </p>
        <button onClick={() => { window.location.hash = '#docs:agents.md:identity'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Identity"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
      </div>

      <div>
        <label className={labelCls}>Name *</label>
        <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="health-monitor" className={inputCls} />
        <p className={hintCls}>Lowercase, kebab-case. This appears everywhere.</p>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Watches for workflow failures and captures diagnostics" className={inputCls} />
        <p className={hintCls}>One sentence that explains what this automation does.</p>
      </div>
    </div>
  );
}
