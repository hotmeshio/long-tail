import { Brain, BookOpen } from 'lucide-react';
import { useListDomains } from '../../../api/knowledge';
import { DateValue } from '../../../components/common/display/DateValue';
import type { AgentFormState } from './agent-form-types';
import { labelCls, hintCls, inputCls } from './agent-form-types';

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function KnowledgeStep({ form, set }: Props) {
  const { data: domainData } = useListDomains();
  const domains = domainData?.domains ?? [];

  return (
    <div className="space-y-6">
      <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between">
        <p className="text-xs text-text-secondary italic leading-relaxed">
          Assign a knowledge domain — the automation's memory. It stores context here over time.
        </p>
        <button onClick={() => { window.location.hash = '#docs:agents.md:knowledge'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Knowledge"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
      </div>

      <div>
        <label className={labelCls}>Knowledge Domain</label>
        <input
          type="text"
          value={form.knowledge_domain}
          onChange={(e) => set('knowledge_domain', e.target.value)}
          placeholder="e.g., system-health, content-review, vendor-data"
          className={inputCls}
          list="domain-suggestions"
        />
        <datalist id="domain-suggestions">
          {domains.map((d) => <option key={d.domain} value={d.domain} />)}
        </datalist>
        <p className={hintCls}>Choose an existing domain to share memory, or type a new name to create one.</p>
      </div>

      {domains.length > 0 && (
        <div>
          <label className={labelCls}>Existing Domains</label>
          <div className="space-y-0.5 mt-2">
            {domains.map((d) => (
              <button
                key={d.domain}
                type="button"
                onClick={() => set('knowledge_domain', d.domain)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                  form.knowledge_domain === d.domain ? 'border-l-2 border-l-accent bg-accent/5' : 'hover:bg-surface-hover border-l-2 border-l-transparent'
                }`}
              >
                <Brain className="w-3.5 h-3.5 text-text-quaternary shrink-0" strokeWidth={1.5} />
                <span className="text-sm text-text-primary flex-1">{d.domain}</span>
                <span className="text-2xs text-text-quaternary">{d.count} entries</span>
                <span className="text-2xs text-text-quaternary"><DateValue date={d.latest} /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
