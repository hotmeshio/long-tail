import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot, Brain, Radio, Clock, Check, Compass,
} from 'lucide-react';
import { useAgent, useCreateAgent, useUpdateAgent } from '../../../api/agents';
import { useAgentSubscriptions, useCreateSubscription, useUpdateSubscription, useDeleteSubscription } from '../../../api/agent-subscriptions';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import {
  EMPTY_FORM,
  agentToForm,
  formToAgentPayload,
  formToSubscriptionPayloads,
} from './agent-form-types';
import type { AgentFormState } from './agent-form-types';
import { IdentityStep } from './IdentityStep';
import { MotivationStep } from './MotivationStep';
import { KnowledgeStep } from './KnowledgeStep';
import { SubscriptionsStep } from './SubscriptionsStep';
import { ScheduleStep } from './ScheduleStep';
import { ReviewStep } from './ReviewStep';

const SECTIONS = [
  { id: 1, label: 'Identity', icon: Bot },
  { id: 2, label: 'Motivation', icon: Compass },
  { id: 3, label: 'Knowledge', icon: Brain },
  { id: 4, label: 'Subscriptions', icon: Radio },
  { id: 5, label: 'Schedules', icon: Clock },
  { id: 6, label: 'Review', icon: Check },
];

export function AgentConfigPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const { data: existing, isLoading } = useAgent(isNew ? null : id!);
  const { data: subsData } = useAgentSubscriptions(isNew ? null : id!);

  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const createSub = useCreateSubscription();
  const updateSub = useUpdateSubscription();
  const deleteSub = useDeleteSubscription();

  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const [initialized, setInitialized] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const section = parseInt(searchParams.get('step') || '1', 10);
  const setSection = useCallback((s: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(s));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (initialized) return;
    if (isNew) { setForm(EMPTY_FORM); setInitialized(true); return; }
    if (existing && subsData) {
      setForm(agentToForm(existing, subsData.subscriptions ?? []));
      setInitialized(true);
    }
  }, [existing, subsData, isNew, initialized]);

  const set = (field: keyof AgentFormState, value: any) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaveError('');
    try {
      const payload = formToAgentPayload(form);
      let agentId = id;

      if (isNew) {
        const created = await createAgent.mutateAsync(payload as any);
        agentId = created.id;
      } else {
        await updateAgent.mutateAsync({ id: id!, ...payload } as any);
      }

      const subPayloads = formToSubscriptionPayloads(form);
      const existingSubs = subsData?.subscriptions ?? [];
      const existingIds = new Set(existingSubs.map((s) => s.id));

      for (const sub of subPayloads) {
        if (sub.id && existingIds.has(sub.id)) {
          const { id: subId, ...rest } = sub;
          await updateSub.mutateAsync({ agentId: agentId!, subId: subId!, ...rest } as any);
          existingIds.delete(subId!);
        } else {
          const { id: _ignored, ...rest } = sub;
          await createSub.mutateAsync({ agentId: agentId!, ...rest } as any);
        }
      }

      for (const removedId of existingIds) {
        await deleteSub.mutateAsync({ agentId: agentId!, subId: removedId });
      }

      navigate(`/agents/${agentId}`);
    } catch (err: any) {
      setSaveError(err.message);
    }
  };

  if (!isNew && isLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-surface-sunken rounded w-48" /><div className="h-60 bg-surface-sunken rounded" /></div>;
  }

  const isPending = createAgent.isPending || updateAgent.isPending;

  return (
    <div>
      <PageHeader
        title={isNew ? 'New Agent' : `Agent: ${existing?.id ?? ''}`}
        docsHash="#docs:agents.md"
      />

      <div className="flex gap-10">
        {/* Section nav — sticky left sidebar */}
        <nav className="w-44 shrink-0 sticky top-0 self-start pt-2">
          <div className="space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors ${
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                  <span className="text-xs font-medium">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Save / Cancel — always visible */}
          <div className="mt-8 pt-4 border-t border-surface-border space-y-2">
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || isPending}
              className="w-full btn-primary text-xs disabled:opacity-50"
            >
              {isPending ? 'Saving...' : isNew ? 'Create Agent' : 'Save'}
            </button>
            <button
              onClick={() => navigate(isNew ? '/agents' : `/agents/${id}`)}
              className="w-full btn-ghost text-xs"
            >
              Cancel
            </button>
          </div>

          {saveError && <p className="text-xs text-status-error mt-3">{saveError}</p>}
        </nav>

        {/* Section content */}
        <div className="flex-1 min-w-0 pt-2">
          {section === 1 && <IdentityStep form={form} set={set} />}
          {section === 2 && <MotivationStep form={form} set={set} />}
          {section === 3 && <KnowledgeStep form={form} set={set} />}
          {section === 4 && <SubscriptionsStep form={form} set={set} />}
          {section === 5 && <ScheduleStep form={form} set={set} />}
          {section === 6 && <ReviewStep form={form} />}
        </div>
      </div>
    </div>
  );
}
