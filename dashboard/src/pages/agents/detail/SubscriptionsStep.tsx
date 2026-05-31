import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, Trash2, Radio, BookOpen } from 'lucide-react';
import { RunAsSelector } from '../../../components/common/form/RunAsSelector';
import { ReactionSelector } from '../../../components/common/form/ReactionSelector';
import { useTopics, type TopicCatalogEntry } from '../../../api/topics';
import { useCapabilities } from '../../../api/capabilities';
import type { AgentFormState, SubscriptionFormState } from './agent-form-types';
import { EMPTY_SUBSCRIPTION, sectionCls, hintCls, inputCls, jsonCls } from './agent-form-types';

const CATEGORY_COLORS: Record<string, string> = {
  task:       'bg-blue-400/15 text-blue-400',
  workflow:   'bg-accent/15 text-accent',
  escalation: 'bg-amber-400/15 text-amber-400',
  activity:   'bg-cyan-400/15 text-cyan-400',
  knowledge:  'bg-violet-400/15 text-violet-400',
  file:       'bg-orange-400/15 text-orange-400',
  agent:      'bg-emerald-400/15 text-emerald-400',
  app:        'bg-rose-400/15 text-rose-400',
  milestone:  'bg-violet-400/15 text-violet-400',
};

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function SubscriptionsStep({ form, set }: Props) {
  const { data: topicsData } = useTopics({ limit: 200 });
  const { data: capData } = useCapabilities();
  const catalogTopics = topicsData?.topics ?? [];
  const allTools = useMemo(() => capData?.categories?.flatMap((c) => c.tools) ?? [], [capData]);
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
  const isComplete = (s: SubscriptionFormState) => {
    if (!s.topic) return false;
    if (s.reaction_type === 'durable') return !!s.workflow_type;
    if (s.reaction_type === 'pipeline') return !!s.pipeline_id;
    if (s.reaction_type === 'mcp_query') return !!s.mcp_prompt;
    if (s.reaction_type === 'capability') return !!s.server_id && !!s.tool_name;
    return false;
  };

  // Find the selected topic's catalog entry for schema preview
  const selectedCatalogEntry = sub ? catalogTopics.find((t) => t.topic === sub.topic) : undefined;

  if (subs.length === 0) {
    return (
      <div className="max-w-xl">
        <div className="border-l-2 border-accent/30 pl-3 py-1 flex items-start justify-between mb-8">
          <p className="text-[12px] text-text-secondary italic leading-relaxed">
            Optional. When a matching event is published, the automation runs the configured workflow with the event payload.
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
          Optional. When a matching event is published, the automation runs the configured workflow with the event payload.
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
                <span className="text-[9px] text-text-quaternary ml-3">→ {s.workflow_type || s.tool_name || s.reaction_type}</span>
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

            {/* Reaction selector — full width */}
            <div>
              <label className={sectionCls}>Run this reaction</label>
              <ReactionSelector
                reactionType={sub.reaction_type}
                onReactionTypeChange={(v) => updateSub(selected, 'reaction_type', v)}
                workflowType={sub.workflow_type}
                onWorkflowTypeChange={(v) => updateSub(selected, 'workflow_type', v)}
                pipelineId={sub.pipeline_id}
                onPipelineIdChange={(v) => updateSub(selected, 'pipeline_id', v)}
                serverId={sub.server_id}
                toolName={sub.tool_name}
                onCapabilityChange={(sid, tn) => {
                  const next = [...form.subscriptions];
                  const entry = { ...next[selected], server_id: sid, tool_name: tn };
                  // Auto-generate mapping template from tool schema
                  const tool = allTools.find((t) => t.serverId === sid && t.name === tn);
                  const props = tool?.inputSchema?.properties as Record<string, any> | undefined;
                  if (props && tn) {
                    const template: Record<string, string> = {};
                    for (const key of Object.keys(props)) {
                      if (key.startsWith('_')) continue;
                      template[key] = `{event.data.${key}}`;
                    }
                    entry.input_mapping = JSON.stringify(template, null, 2);
                  }
                  next[selected] = entry;
                  set('subscriptions', next);
                }}
                mcpPrompt={sub.mcp_prompt}
                onMcpPromptChange={(v) => updateSub(selected, 'mcp_prompt', v)}

              />
            </div>

            {/* Identity + Filter — 2 col */}
            <div className="grid grid-cols-2 gap-6">
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
              {sub.reaction_type === 'capability' && sub.tool_name ? (
                <CapabilityMappingForm
                  tool={allTools.find((t) => t.serverId === sub.server_id && t.name === sub.tool_name)}
                  value={sub.input_mapping}
                  onChange={(v) => updateSub(selected, 'input_mapping', v)}
                  eventSchema={selectedCatalogEntry?.payload_schema}
                />
              ) : (
                <>
                  <textarea value={sub.input_mapping} onChange={(e) => updateSub(selected, 'input_mapping', e.target.value)} rows={10} className={jsonCls} placeholder={'{\n  "data": {\n    "orderId": "{event.data.orderId}",\n    "error": "{event.data.error}"\n  }\n}'} />
                  <p className={hintCls}>Maps event fields to workflow input. {'{event.data.fieldName}'} resolves at runtime.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Capability Mapping Form ─────────────────────────────────────────────────

function CapabilityMappingForm({ tool, value, onChange, eventSchema }: {
  tool?: { name: string; description?: string; inputSchema: Record<string, any> };
  value: string;
  onChange: (v: string) => void;
  eventSchema?: Record<string, any>;
}) {
  const [jsonMode, setJsonMode] = useState(false);
  const props = (tool?.inputSchema?.properties ?? {}) as Record<string, any>;
  const required = (tool?.inputSchema?.required as string[]) ?? [];
  const allFields = Object.entries(props).filter(([k]) => !k.startsWith('_'));

  // Required fields first, then optional
  const fields = useMemo(() => {
    const req = allFields.filter(([k]) => required.includes(k));
    const opt = allFields.filter(([k]) => !required.includes(k));
    return [...req, ...opt];
  }, [allFields, required]);

  // Build event field suggestions from the topic's payload schema
  const eventSuggestions = useMemo(() => {
    const suggestions: Array<{ value: string; label: string }> = [
      { value: '{event.type}', label: 'event type' },
      { value: '{event.source}', label: 'event source' },
      { value: '{event.timestamp}', label: 'ISO timestamp' },
      { value: '{event.workflowId}', label: 'workflow ID' },
      { value: '{event.workflowName}', label: 'workflow name' },
    ];
    const schemaProps = eventSchema?.properties as Record<string, any> | undefined;
    if (schemaProps) {
      for (const [key, def] of Object.entries(schemaProps)) {
        suggestions.push({
          value: `{event.data.${key}}`,
          label: (def as any).description || key,
        });
      }
    }
    return suggestions;
  }, [eventSchema]);

  const parsed = useMemo(() => {
    try { return JSON.parse(value) as Record<string, any>; }
    catch { return {} as Record<string, any>; }
  }, [value]);

  const updateField = (key: string, fieldValue: any) => {
    const next = { ...parsed, [key]: fieldValue };
    onChange(JSON.stringify(next, null, 2));
  };

  if (fields.length === 0 || jsonMode) {
    return (
      <div>
        {fields.length > 0 && (
          <div className="flex justify-end mb-1">
            <button type="button" onClick={() => setJsonMode(false)} className="text-[10px] text-accent hover:text-accent-hover transition-colors">Form view</button>
          </div>
        )}
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={8} className={jsonCls} placeholder={'{\n  "domain": "{event.data.name}",\n  "key": "{event.data.path}"\n}'} />
        <p className={hintCls}>Maps event fields to capability inputs. {'{event.data.fieldName}'} resolves at runtime.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-text-tertiary">
          Map each input to an event field or enter a static value.
        </p>
        <button type="button" onClick={() => setJsonMode(true)} className="text-[10px] text-text-tertiary hover:text-accent transition-colors">Raw JSON</button>
      </div>

      <div className="space-y-4">
        {fields.map(([key, def]) => {
          const isReq = required.includes(key);
          const desc = (def as any).description;
          const fieldType = (def as any).type;
          const currentVal = typeof parsed[key] === 'string' ? parsed[key]
            : typeof parsed[key] === 'object' ? JSON.stringify(parsed[key])
            : parsed[key] != null ? String(parsed[key]) : '';

          return (
            <div key={key} className="bg-surface-sunken/30 rounded-md px-4 py-3">
              <div className="flex items-baseline gap-2 mb-0.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  {key.replace(/[_-]/g, ' ')}
                  {isReq && <span className="text-status-error ml-0.5">*</span>}
                </label>
                {fieldType && <span className="text-[9px] text-text-quaternary">{fieldType}</span>}
              </div>
              {desc && <p className="text-[10px] text-text-quaternary mb-2">{desc}</p>}
              <MappingFieldInput
                value={currentVal}
                onChange={(v) => updateField(key, v)}
                suggestions={eventSuggestions}
                fieldType={fieldType}
                placeholder={`{event.data.${key}}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Input with dropdown suggestions for event field references */
function MappingFieldInput({ value, onChange, suggestions, fieldType, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  suggestions: Array<{ value: string; label: string }>;
  fieldType?: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = suggestions.filter((s) =>
    s.value.toLowerCase().includes(filter.toLowerCase()) ||
    s.label.toLowerCase().includes(filter.toLowerCase()),
  );

  if (fieldType === 'object') {
    return (
      <textarea
        value={value}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)); }
          catch { onChange(e.target.value); }
        }}
        rows={3}
        className={`${jsonCls} text-xs`}
        placeholder={`{ "source": "{event.source}" }`}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onFocus={() => { setOpen(true); setFilter(''); }}
        onChange={(e) => { onChange(e.target.value); setFilter(e.target.value); if (!open) setOpen(true); }}
        className="input font-mono text-xs w-full"
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg">
          {filtered.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => { onChange(s.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-surface-hover transition-colors flex items-center gap-3 ${value === s.value ? 'bg-accent/5' : ''}`}
            >
              <span className="text-[11px] font-mono text-accent shrink-0">{s.value}</span>
              <span className="text-[10px] text-text-quaternary truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
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
