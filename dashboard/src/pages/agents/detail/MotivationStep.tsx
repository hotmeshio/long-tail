import { BookOpen } from 'lucide-react';
import type { AgentFormState } from './agent-form-types';
import { labelCls, hintCls, inputCls } from './agent-form-types';

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function MotivationStep({ form, set }: Props) {
  return (
    <div className="space-y-8">
      <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between">
        <p className="text-xs text-text-secondary italic leading-relaxed">
          Goals define what drives the automation. Rules define what constrains it.
        </p>
        <button onClick={() => { window.location.hash = '#docs:agents.md:motivation'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Motivation"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <label className={labelCls}>Goals</label>
          <textarea value={form.goals} onChange={(e) => set('goals', e.target.value)} placeholder="Detect failures early, capture diagnostics, alert before cascading" rows={4} className={`${inputCls} resize-none`} />
          <p className={hintCls}>Primary motivation. What the automation is trying to achieve.</p>
        </div>
        <div>
          <label className={labelCls}>Rules</label>
          <textarea value={form.rules} onChange={(e) => set('rules', e.target.value)} placeholder="Never auto-restart failed workflows. Always escalate to humans." rows={4} className={`${inputCls} resize-none`} />
          <p className={hintCls}>Guardrails. What it must never do, even when goals suggest it should.</p>
        </div>
      </div>
    </div>
  );
}
