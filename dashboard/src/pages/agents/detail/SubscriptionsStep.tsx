import { useState } from 'react';
import { Plus, Trash2, Radio, BookOpen } from 'lucide-react';
import { useWorkflowConfigs } from '../../../api/workflows';
import type { AgentFormState, SubscriptionFormState } from './agent-form-types';
import { EMPTY_SUBSCRIPTION, labelCls, hintCls, inputCls, jsonCls } from './agent-form-types';

const TOPIC_EXAMPLES = [
  'workflow.failed',
  'activity.failed',
  'escalation.created',
  'knowledge.stored',
  'app.>',
  'app.*.*.error',
];

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function SubscriptionsStep({ form, set }: Props) {
  const { data: configs } = useWorkflowConfigs();
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
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                selected === i ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isComplete(s) ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                <span className="text-[11px] font-mono truncate">{s.topic || 'new subscription'}</span>
              </div>
              <span className="text-[9px] text-text-quaternary ml-3">→ {s.workflow_type || s.reaction_type}</span>
            </button>
          ))}
          <button onClick={addSub} className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>

        {/* Detail form */}
        {sub && (
          <div className="flex-1 min-w-0 space-y-7">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">Subscription {selected + 1}</span>
              <button onClick={() => removeSub(selected)} className="text-text-quaternary hover:text-red-400 transition-colors" title="Remove">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Topic + shortcut chips */}
            <div>
              <label className={labelCls}>When this event fires</label>
              <input type="text" value={sub.topic} onChange={(e) => updateSub(selected, 'topic', e.target.value)} placeholder="workflow.failed" className={`${inputCls} font-mono`} />
              <div className="flex gap-1.5 mt-2 overflow-x-auto">
                {TOPIC_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => updateSub(selected, 'topic', ex)}
                    className={`px-2 py-0.5 text-[9px] font-mono rounded whitespace-nowrap transition-colors ${sub.topic === ex ? 'bg-accent/20 text-accent' : 'text-text-quaternary hover:text-text-secondary border border-surface-border/40'}`}
                  >{ex}</button>
                ))}
              </div>
            </div>

            {/* Reaction: type + target + filter — 2-col */}
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>Run this</label>
                  <div className="flex gap-3 mt-1.5">
                    {(['durable', 'pipeline', 'mcp_query'] as const).map((rt) => (
                      <label key={rt} className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
                        <input type="radio" name="reaction" checked={sub.reaction_type === rt} onChange={() => updateSub(selected, 'reaction_type', rt)} className="accent-accent w-3 h-3" />
                        {rt === 'durable' ? 'Workflow' : rt === 'pipeline' ? 'Pipeline' : 'MCP Query'}
                      </label>
                    ))}
                  </div>
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
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>Only when</label>
                  <input type="text" value={sub.filter} onChange={(e) => updateSub(selected, 'filter', e.target.value)} placeholder="No filter (all matching events)" className={`${inputCls} font-mono text-xs`} />
                  <p className={hintCls}>JSON filter against event.data, e.g. {`{"status": 422}`}</p>
                </div>
                <div>
                  <label className={labelCls}>Run As</label>
                  <input type="text" value={sub.execute_as} onChange={(e) => updateSub(selected, 'execute_as', e.target.value)} placeholder="Agent's service account" className={`${inputCls} text-xs`} />
                  <p className={hintCls}>Override identity for this subscription.</p>
                </div>
              </div>
            </div>

            {/* Input Mapping full width */}
            <div>
              <label className={labelCls}>With this data</label>
              <textarea value={sub.input_mapping} onChange={(e) => updateSub(selected, 'input_mapping', e.target.value)} rows={5} className={jsonCls} placeholder={'{\n  "data": {\n    "orderId": "{event.data.orderId}",\n    "error": "{event.data.error}"\n  }\n}'} />
              <p className={hintCls}>Maps event fields to workflow input. {'{event.data.fieldName}'} resolves at runtime.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
