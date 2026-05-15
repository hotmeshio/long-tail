import { Bot, Compass, Brain, Radio, Clock } from 'lucide-react';
import { EventTopicPill } from '../../../components/common/display/EventTopicPill';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import type { AgentFormState } from './agent-form-types';

interface Props {
  form: AgentFormState;
}

function Section({ icon: Icon, color, title, children }: { icon: React.ElementType; color: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-surface-border/40">
        <Icon className={`w-3.5 h-3.5 ${color}`} strokeWidth={1.5} />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-accent/80">{title}</h3>
      </div>
      <div className="pl-5.5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="text-[10px] text-text-quaternary w-20 shrink-0">{label}</span>
      <span className="text-xs text-text-primary">{children}</span>
    </div>
  );
}

export function ReviewStep({ form }: Props) {
  return (
    <div>
      <Section icon={Bot} color="text-accent" title="Identity">
        <Field label="Name">{form.name || '—'}</Field>
        {form.description && <Field label="Description">{form.description}</Field>}
      </Section>

      {(form.goals || form.rules) && (
        <Section icon={Compass} color="text-rose-400" title="Motivation">
          {form.goals && <Field label="Goals">{form.goals}</Field>}
          {form.rules && <Field label="Rules">{form.rules}</Field>}
        </Section>
      )}

      <Section icon={Brain} color="text-emerald-400" title="Knowledge">
        <Field label="Domain">{form.knowledge_domain || 'None'}</Field>
      </Section>

      {/* Subscriptions + Schedule side by side */}
      <div className="grid grid-cols-2 gap-x-10">
        <Section icon={Radio} color="text-cyan-400" title={`Subscriptions (${form.subscriptions.length})`}>
          {form.subscriptions.length === 0 ? (
            <span className="text-[11px] text-text-quaternary">None configured</span>
          ) : (
            <div className="divide-y divide-surface-border/30">
              {form.subscriptions.map((sub, i) => (
                <div key={i} className="flex items-center py-1.5">
                  <div className="flex-1 min-w-0"><EventTopicPill topic={sub.topic || 'unset'} /></div>
                  <div className="flex items-center gap-1.5 shrink-0"><span className="text-text-quaternary text-[10px]">→</span>{sub.workflow_type ? <WorkflowPill type={sub.workflow_type} /> : <span className="text-[11px] text-text-quaternary">{sub.reaction_type}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={Clock} color="text-amber-400" title={`Schedules (${form.schedules.length})`}>
          {form.schedules.length === 0 ? (
            <span className="text-[11px] text-text-quaternary">None configured</span>
          ) : (
            <div className="divide-y divide-surface-border/30">
              {form.schedules.map((s, i) => (
                <div key={i} className="flex items-center py-1.5">
                  <div className="flex-1 min-w-0"><span className="text-xs font-mono text-text-primary">{s.cron}</span></div>
                  <div className="flex items-center gap-1.5 shrink-0"><span className="text-text-quaternary text-[10px]">→</span>{s.workflow_type ? <WorkflowPill type={s.workflow_type} /> : <span className="text-[11px] text-text-quaternary">no workflow</span>}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="border-l-2 border-emerald-400/30 pl-3 py-2 mt-6">
        <p className="text-[11px] text-text-tertiary leading-relaxed">
          After saving, subscriptions and schedules activate immediately. You can pause the agent anytime.
        </p>
      </div>
    </div>
  );
}
