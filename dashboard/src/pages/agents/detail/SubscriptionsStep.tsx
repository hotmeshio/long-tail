import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Radio, BookOpen } from 'lucide-react';
import { RunAsSelector } from '../../../components/common/form/RunAsSelector';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useTopics, type TopicCatalogEntry } from '../../../api/topics';
import type { AgentFormState, SubscriptionFormState } from './agent-form-types';
import { EMPTY_SUBSCRIPTION, sectionCls, labelCls, hintCls, inputCls, jsonCls } from './agent-form-types';

const CATEGORY_COLORS: Record<string, string> = {
  task:       'bg-blue-400/15 text-blue-400',
  workflow:   'bg-accent/15 text-accent',
  escalation: 'bg-amber-400/15 text-amber-400',
  activity:   'bg-cyan-400/15 text-cyan-400',
  knowledge:  'bg-violet-400/15 text-violet-400',
  agent:      'bg-emerald-400/15 text-emerald-400',
  app:        'bg-rose-400/15 text-rose-400',
  milestone:  'bg-violet-400/15 text-violet-400',
};

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function SubscriptionsStep({ form, set }: Props) {
  const { data: configs } = useWorkflowConfigs();
  const { data: topicsData } = useTopics({ limit: 200 });
  const catalogTopics = topicsData?.topics ?? [];

  const invocableWorkflows = (configs ?? []).filter((c: any) => c.invocable).map((c: any) => c.workflow_type);
  const [selected, setSelected] = useState(0);

  const updateSub = (index: number, field: keyof SubscriptionFormState, value: any) => {
    const next = [...form.subscriptions];
    next[index] = { ...next[index], [field]: value };
    set('subscriptions', next);
  };

  const addSub = () => {
    set('subscriptions', [...form.subscriptions, { ...EMPTY_SUBSCRIPTION }]);
    setSelected(form.subscriptions.length);
  };

  const removeSub = (index: number) => {
    set('subscriptions', form.subscriptions.filter((_, i) => i !== index));
    if (selected >= form.subscriptions.length - 1) setSelected(Math.max(0, form.subscriptions.length - 2));
  };

  const subs = form.subscriptions;
  const sub = subs[selected];
  const isComplete = (s: SubscriptionFormState) => !!s.topic && (s.reaction_type === 'durable' ? !!s.workflow_type : s.reaction_type === 'pipeline' ? !!s.pipeline_id : !!s.mcp_prompt);

  // Find the selected topic's catalog entry for schema preview
  const selectedCatalogEntry = sub ? catalogTopics.find((t) => t.topic === sub.topic) : undefined;

  if (subs.length === 0) {
    return (
      <div className="max-w-xl">
        <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between mb-8">
          <p className="text-[12px] text-text-secondary italic leading-relaxed">
            Optional. When a matching event is published, the agent runs the configured workflow with the event payload.
          </p>
          <button onClick={() => { window.location.hash = '#docs:agents.md:subscriptions'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Subscriptions"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Radio className="w-8 h-8 text-text-quaternary/40 mb-3" strokeWidth={1} />
          <p className="text-sm text-text-tertiary mb-2">No event subscriptions yet</p>
          <p className="text-[11px] text-text-quaternary max-w-sm mb-6">
            Each subscription listens for a topic pattern and runs a workflow when it matches.
          </p>
          <button onClick={addSub} className="flex items-center gap-2 text-xs text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add first subscription
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between mb-6">
        <p className="text-[12px] text-text-secondary italic leading-relaxed">
          Optional. When a matching event is published, the agent runs the configured workflow with the event payload.
        </p>
        <button onClick={() => { window.location.hash = '#docs:agents.md:subscriptions'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Subscriptions"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
      </div>

      <div className="flex gap-8">
        {/* Sub-index */}
        <div className="w-52 shrink-0 space-y-0.5">
          {subs.map((s, i) => (
            <div key={i} className={`group/sub flex items-center rounded-md transition-colors ${
              selected === i ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
            }`}>
              <button onClick={() => setSelected(i)} className="flex-1 text-left px-3 py-2 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isComplete(s) ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                  <span className="text-[11px] font-mono truncate">{s.topic || 'new subscription'}</span>
                </div>
                <span className="text-[9px] text-text-quaternary ml-3">→ {s.workflow_type || s.reaction_type}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove subscription "${s.topic || 'new'}"?\n\nThis takes effect when you save.`)) removeSub(i); }} className="opacity-0 group-hover/sub:opacity-100 px-2 text-text-quaternary hover:text-red-400 transition-all" title="Remove">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={addSub} className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>

        {/* Detail form */}
        {sub && (
          <div className="flex-1 min-w-0 space-y-12">

            {/* When — topic combobox */}
            <div>
              <label className={sectionCls}>When this event fires</label>
              <TopicCombobox
                value={sub.topic}
                onChange={(v) => updateSub(selected, 'topic', v)}
                topics={catalogTopics}
              />

              {/* Schema preview when a catalog topic is selected */}
              {selectedCatalogEntry?.payload_schema && (
                <div className="mt-3 p-3 rounded-md bg-surface-sunken border border-surface-border">
                  <p className="text-[10px] text-text-quaternary mb-1 uppercase tracking-wider font-medium">Payload Schema</p>
                  <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-40">
                    {JSON.stringify(selectedCatalogEntry.payload_schema.properties ?? selectedCatalogEntry.payload_schema, null, 2)}
                  </pre>
                  {selectedCatalogEntry.description && (
                    <p className="text-[10px] text-text-tertiary mt-2 italic">{selectedCatalogEntry.description}</p>
                  )}
                </div>
              )}
            </div>

            {/* Run this workflow + As identity + But only if — 3 col */}
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-4">
                <label className={sectionCls}>Run this workflow</label>
                <div className="flex gap-3">
                  {(['durable', 'pipeline', 'mcp_query'] as const).map((rt) => (
                    <label key={rt} className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
                      <input type="radio" name="reaction" checked={sub.reaction_type === rt} onChange={() => updateSub(selected, 'reaction_type', rt)} className="accent-accent w-3 h-3" />
                      {rt === 'durable' ? 'Workflow' : rt === 'pipeline' ? 'Pipeline' : 'MCP Query'}
                    </label>
                  ))}
                </div>
                {sub.reaction_type === 'durable' && (
                  <div>
                    <label className={labelCls}>Workflow *</label>
                    <select value={sub.workflow_type} onChange={(e) => updateSub(selected, 'workflow_type', e.target.value)} className={inputCls}>
                      <option value="">Select...</option>
                      {invocableWorkflows.map((wt: string) => <option key={wt} value={wt}>{wt}</option>)}
                    </select>
                  </div>
                )}
                {sub.reaction_type === 'pipeline' && (
                  <div>
                    <label className={labelCls}>Pipeline ID *</label>
                    <input type="text" value={sub.pipeline_id} onChange={(e) => updateSub(selected, 'pipeline_id', e.target.value)} placeholder="UUID" className={`${inputCls} font-mono text-xs`} />
                  </div>
                )}
                {sub.reaction_type === 'mcp_query' && (
                  <div>
                    <label className={labelCls}>Prompt *</label>
                    <textarea value={sub.mcp_prompt} onChange={(e) => updateSub(selected, 'mcp_prompt', e.target.value)} placeholder="Analyze the error..." rows={2} className={`${inputCls} resize-none`} />
                  </div>
                )}
              </div>
              <div>
                <label className={sectionCls}>As identity</label>
                <RunAsSelector selected={sub.execute_as} onChange={(v) => updateSub(selected, 'execute_as', v)} />
                <p className={hintCls}>Identity used when invoking the workflow.</p>
              </div>
              <div>
                <label className={sectionCls}>But only if</label>
                <input type="text" value={sub.filter} onChange={(e) => updateSub(selected, 'filter', e.target.value)} placeholder="No filter (all matching events)" className={`${inputCls} font-mono text-xs`} />
                <p className={hintCls}>JSON filter against event.data, e.g. {`{"status": 422}`}</p>
              </div>
            </div>

            {/* Input Mapping full width */}
            <div>
              <label className={sectionCls}>With this data</label>
              <textarea value={sub.input_mapping} onChange={(e) => updateSub(selected, 'input_mapping', e.target.value)} rows={10} className={jsonCls} placeholder={'{\n  "data": {\n    "orderId": "{event.data.orderId}",\n    "error": "{event.data.error}"\n  }\n}'} />
              <p className={hintCls}>Maps event fields to workflow input. {'{event.data.fieldName}'} resolves at runtime.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Topic Combobox ──────────────────────────────────────────────────────────

function TopicCombobox({ value, onChange, topics }: {
  value: string;
  onChange: (v: string) => void;
  topics: TopicCatalogEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filterText = open ? filter : value;
  const filtered = topics.filter((t) =>
    t.topic.toLowerCase().includes((open ? filter : '').toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes((open ? filter : '').toLowerCase()),
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={filterText}
        onFocus={() => { setOpen(true); setFilter(value); }}
        onChange={(e) => {
          const v = e.target.value;
          setFilter(v);
          onChange(v);
          if (!open) setOpen(true);
        }}
        placeholder="workflow.failed or app.>"
        className={`${inputCls} font-mono`}
      />

      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg">
          {filtered.map((t) => {
            const catCls = CATEGORY_COLORS[t.category] ?? 'bg-zinc-400/15 text-zinc-400';
            return (
              <button
                key={t.topic}
                type="button"
                onClick={() => {
                  onChange(t.topic);
                  setFilter(t.topic);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-center gap-3 ${
                  value === t.topic ? 'bg-accent/5' : ''
                }`}
              >
                <span className="text-[11px] font-mono text-text-primary shrink-0">{t.topic}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${catCls}`}>{t.category}</span>
                {t.description && (
                  <span className="text-[10px] text-text-quaternary truncate">{t.description}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
