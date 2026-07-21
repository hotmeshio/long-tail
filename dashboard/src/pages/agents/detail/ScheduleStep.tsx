import { useState } from 'react';
import { Plus, Trash2, Clock, BookOpen } from 'lucide-react';
import { RunAsSelector } from '../../../components/common/form/RunAsSelector';
import { ReactionSelector } from '../../../components/common/form/ReactionSelector';
import type { AgentFormState, ScheduleFormState } from './agent-form-types';
import { EMPTY_SCHEDULE, sectionCls, hintCls, inputCls, jsonCls } from './agent-form-types';

const CRON_PRESETS = [
  '*/5 * * * *',
  '*/15 * * * *',
  '0 * * * *',
  '0 */4 * * *',
  '0 7 * * *',
  '0 9 * * 1-5',
];

function describeCron(expr: string): string {
  const m: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 min',
    '*/15 * * * *': 'Every 15 min',
    '0 * * * *': 'Hourly',
    '0 */4 * * *': 'Every 4 hours',
    '0 7 * * *': 'Daily 7 AM UTC',
    '0 9 * * 1-5': 'Weekdays 9 AM UTC',
    '0 0 * * 1': 'Weekly Monday',
  };
  return m[expr] || expr;
}

interface Props {
  form: AgentFormState;
  set: (field: keyof AgentFormState, value: any) => void;
}

export function ScheduleStep({ form, set }: Props) {
  const [selected, setSelected] = useState(0);

  const updateSched = (index: number, field: keyof ScheduleFormState, value: any) => {
    const next = [...form.schedules];
    next[index] = { ...next[index], [field]: value };
    set('schedules', next);
  };

  const addSched = () => {
    set('schedules', [...form.schedules, { ...EMPTY_SCHEDULE }]);
    setSelected(form.schedules.length);
  };

  const removeSched = (index: number) => {
    set('schedules', form.schedules.filter((_: any, i: number) => i !== index));
    if (selected >= form.schedules.length - 1) setSelected(Math.max(0, form.schedules.length - 2));
  };

  const scheds = form.schedules;
  const sched = scheds[selected];

  if (scheds.length === 0) {
    return (
      <div>
        <div className="border-l-2 border-accent/30 pl-3 py-1 mb-8 flex items-start justify-between">
          <p className="text-xs text-text-secondary italic leading-relaxed">
            Optional. Each schedule runs a workflow on a cron timer.
          </p>
          <button onClick={() => { window.location.hash = '#docs:agents.md:schedule'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Schedule"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="w-8 h-8 text-text-quaternary/40 mb-3" strokeWidth={1} />
          <p className="text-sm text-text-tertiary mb-2">No schedules</p>
          <p className="text-2xs text-text-quaternary max-w-sm mb-6">
            Add a schedule to run a workflow on a recurring cron timer.
          </p>
          <button onClick={addSched} className="flex items-center gap-2 text-xs text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add schedule
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="border-l-2 border-accent/30 pl-3 py-1 mb-6 flex items-start justify-between">
        <p className="text-xs text-text-secondary italic leading-relaxed">
          Each schedule runs a workflow on a timer. An automation can have multiple schedules targeting different workflows.
        </p>
        <button onClick={() => { window.location.hash = '#docs:agents.md:schedule'; }} className="text-text-quaternary hover:text-accent transition-colors shrink-0 ml-3" title="Docs: Schedule"><BookOpen className="w-3 h-3" strokeWidth={1.5} /></button>
      </div>

      <div className="flex gap-8">
        {/* Sub-index */}
        <div className="w-48 shrink-0 space-y-0.5">
          {scheds.map((s, i) => (
            <div key={i} className={`group/sched flex items-center rounded-md transition-colors ${
              selected === i ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
            }`}>
              <button onClick={() => setSelected(i)} className="flex-1 text-left px-3 py-2 min-w-0">
                <span className="text-2xs font-mono block">{s.cron || 'new schedule'}</span>
                <span className="text-2xs text-text-quaternary">{(s.reaction_type === 'pipeline' ? s.pipeline_id : s.workflow_type) || 'no target'} · {describeCron(s.cron)}</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove schedule "${s.cron || 'new'}"?\n\nThis takes effect when you save.`)) removeSched(i); }} className="opacity-0 group-hover/sched:opacity-100 px-2 text-text-quaternary hover:text-status-error transition-all" title="Remove">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={addSched} className="w-full flex items-center gap-1.5 px-3 py-2 text-2xs text-accent hover:text-accent-hover transition-colors">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>

        {/* Detail form */}
        {sched && (
          <div className="flex-1 min-w-0 space-y-12">

            {/* Every — cron + presets */}
            <div>
              <label className={sectionCls}>Run every</label>
              <input type="text" value={sched.cron} onChange={(e) => updateSched(selected, 'cron', e.target.value)} placeholder="0 * * * *" className={`${inputCls} font-mono`} />
              {sched.cron && <p className="text-2xs text-accent/80 mt-1">{describeCron(sched.cron)}</p>}
              <div className="flex gap-3 mt-2 overflow-x-auto">
                {CRON_PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => updateSched(selected, 'cron', p)}
                    className={`text-2xs font-mono whitespace-nowrap transition-colors ${sched.cron === p ? 'text-accent font-medium' : 'text-accent/50 hover:text-accent'}`}
                  >{describeCron(p)}</button>
                ))}
              </div>
            </div>

            {/* Run this reaction */}
            <div>
              <label className={sectionCls}>Run this reaction</label>
              <ReactionSelector
                reactionType={sched.reaction_type}
                onReactionTypeChange={(v) => updateSched(selected, 'reaction_type', v)}
                workflowType={sched.workflow_type}
                onWorkflowTypeChange={(v) => updateSched(selected, 'workflow_type', v)}
                pipelineId={sched.pipeline_id}
                onPipelineIdChange={(v) => updateSched(selected, 'pipeline_id', v)}
                serverId={sched.server_id}
                toolName={sched.tool_name}
                onCapabilityChange={(sid, tn) => { updateSched(selected, 'server_id', sid); updateSched(selected, 'tool_name', tn); }}
                availableTypes={['durable', 'pipeline', 'capability']}

              />
            </div>

            {/* As identity */}
            <div>
              <label className={sectionCls}>As identity</label>
              <RunAsSelector selected={sched.execute_as} onChange={(v) => updateSched(selected, 'execute_as', v)} />
              <p className={hintCls}>Identity used when invoking.</p>
            </div>

            {/* Envelope */}
            <div>
              <label className={sectionCls}>With this data</label>
              <textarea value={sched.envelope} onChange={(e) => updateSched(selected, 'envelope', e.target.value)} rows={10} className={jsonCls} placeholder={'{\n  "data": { "source": "cron" }\n}'} />
              <p className={hintCls}>Static payload passed to the workflow on each invocation.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
