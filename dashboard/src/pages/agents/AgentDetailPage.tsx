import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Bot, Play, Pause, Trash2, ArrowRight, ArrowUpRight, Pencil, BookOpen,
  Radio, Clock, Brain, Compass,
} from 'lucide-react';
import { useAgent, useUpdateAgent, useDeleteAgent } from '../../api/agents';
import { useSettings } from '../../api/settings';
import { useAgentSubscriptions } from '../../api/agent-subscriptions';
import { useAgentEvents } from '../../hooks/useEventHooks';
import { useEventSubscription } from '../../hooks/useEventContext';
import { NATS_SUBJECT_PREFIX } from '../../lib/nats/config';
import { EventTopicPill } from '../../components/common/display/EventTopicPill';
import { CronLabel } from '../../components/common/display/CronLabel';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SectionHeader({ icon: Icon, color, children, actions }: { icon: React.ElementType; color: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 pb-2 border-b border-surface-border">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-accent/80">{children}</h2>
      </div>
      {actions}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-[11px] text-text-quaternary py-2">{text}</p>;
}

/** Per-section deeplink — jumps straight to that section instead of Edit → navigate. */
function SectionViewLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="text-text-quaternary hover:text-accent transition-colors"
      title={`View ${label}`}
      aria-label={`View ${label}`}
    >
      <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={1.5} />
    </button>
  );
}

// ── Live feed ───────────────────────────────────────────────────────────────

interface FeedEvent { id: number; type: string; timestamp: string; label: string; }
let feedCounter = 0;

function useAgentFeed(agentName?: string) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [pulse, setPulse] = useState(false);
  const handler = useCallback((event: any) => {
    if (event.type?.startsWith('mesh.')) return;
    const label = event.activityName || event.data?.domain || event.workflowId?.slice(0, 16) || '';
    setEvents((prev) => [{ id: ++feedCounter, type: event.type, timestamp: event.timestamp, label }, ...prev].slice(0, 10));
    setPulse(true);
    setTimeout(() => setPulse(false), 2000);
  }, []);
  useEventSubscription(
    agentName ? `${NATS_SUBJECT_PREFIX}.system.agent.${agentName}.>` : '',
    handler,
  );
  return { events, pulse };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const aiEnabled = !!settings?.ai?.enabled;
  const label = aiEnabled ? 'Agent' : 'Automation';
  const { data: agent, isLoading } = useAgent(id ?? null);
  const { data: subsData } = useAgentSubscriptions(id ?? null);
  const updateMutation = useUpdateAgent();
  const deleteMutation = useDeleteAgent();
  const { events: liveEvents, pulse } = useAgentFeed(id);
  useAgentEvents();

  if (isLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-surface-sunken rounded w-48" /><div className="h-40 bg-surface-sunken rounded" /></div>;
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Bot className="w-12 h-12 text-text-quaternary mb-4" strokeWidth={1} />
        <h2 className="text-lg font-medium text-text-primary mb-2">{label} not found</h2>
        <button onClick={() => navigate('/agents')} className="text-sm text-accent hover:text-accent-hover transition-colors">Back to {label.toLowerCase()}s</button>
      </div>
    );
  }

  const statusDot = agent.status === 'active' ? 'bg-emerald-400' : agent.status === 'paused' ? 'bg-amber-400' : agent.status === 'error' ? 'bg-red-400' : 'bg-zinc-500';
  const subs = subsData?.subscriptions ?? [];
  const statusLabel = agent.status === 'active' ? 'Active' : agent.status === 'paused' ? 'Paused' : agent.status === 'error' ? 'Error' : 'Inactive';
  const schedules = (agent.behaviors as any)?.schedules as any[] | undefined;
  const legacyCron = agent.behaviors?.cron;
  const schedCount = schedules?.length || (legacyCron ? 1 : 0);

  const handlePause = () => {
    const msg = [
      `Pause "${agent.id}"?`,
      '',
      'This will:',
      subs.length > 0 ? `• Stop ${subs.length} event subscription${subs.length !== 1 ? 's' : ''}` : null,
      schedCount > 0 ? `• Stop ${schedCount} schedule${schedCount !== 1 ? 's' : ''}` : null,
      '',
      'Knowledge and workflow history are preserved. You can reactivate anytime.',
    ].filter(Boolean).join('\n');
    if (confirm(msg)) updateMutation.mutate({ id: agent.id, status: 'paused' as any });
  };

  const handleDelete = () => {
    const msg = [
      `Delete "${agent.id}"?`,
      '',
      'This permanently removes:',
      '• The agent configuration',
      subs.length > 0 ? `• ${subs.length} event subscription${subs.length !== 1 ? 's' : ''}` : null,
      schedCount > 0 ? `• ${schedCount} schedule${schedCount !== 1 ? 's' : ''}` : null,
      '',
      'Knowledge entries and workflow history are preserved.',
    ].filter(Boolean).join('\n');
    if (confirm(msg)) deleteMutation.mutate(agent.id, { onSuccess: () => navigate('/agents') });
  };

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-light text-text-primary">{label}: {agent.id}</h1>
          <button onClick={() => { window.location.hash = '#docs:agents.md'; }} className="text-text-quaternary hover:text-accent transition-colors mt-1" title="Docs">
            <BookOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 mr-2">
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className="text-xs text-text-secondary capitalize">{statusLabel}</span>
          </div>
          <button onClick={() => navigate(`/agents/${agent.id}/edit`)} className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
            <Pencil className="w-3 h-3" /> Edit
          </button>
          {agent.status !== 'active' && (
            <button onClick={() => updateMutation.mutate({ id: agent.id, status: 'active' as any })} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-emerald-400 hover:bg-emerald-600/10 transition-colors">
              <Play className="w-3 h-3" /> Activate
            </button>
          )}
          {agent.status === 'active' && (
            <button onClick={handlePause} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors">
              <Pause className="w-3 h-3" /> Pause
            </button>
          )}
          <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-600/10 transition-colors">
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </div>

      {/* Description callout */}
      {agent.description && (
        <div className="border-l-2 border-accent/30 pl-4 py-1 mb-10">
          <p className="text-[13px] text-text-secondary italic leading-relaxed">{agent.description}</p>
        </div>
      )}

      {/* Motivation */}
      {(agent.goals || agent.rules) && (
        <div className="mb-10">
          <SectionHeader
            icon={Compass}
            color="text-rose-400"
            actions={<SectionViewLink to={`/agents/${agent.id}/edit?step=2`} label="Motivation" />}
          >Motivation</SectionHeader>
          <div className="grid grid-cols-2 gap-x-14 bg-surface-sunken/20 rounded-lg px-5 py-4">
            {agent.goals && (
              <div>
                <p className="text-[9px] text-text-quaternary uppercase tracking-widest mb-1.5">Goals</p>
                <p className="text-[13px] text-text-primary leading-relaxed">{agent.goals}</p>
              </div>
            )}
            {agent.rules && (
              <div>
                <p className="text-[9px] text-text-quaternary uppercase tracking-widest mb-1.5">Rules</p>
                <p className="text-[13px] text-text-primary leading-relaxed">{agent.rules}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3-column grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-14 gap-y-10">

        {/* Col 1: Subscriptions */}
        <div>
          <SectionHeader
            icon={Radio}
            color="text-cyan-400"
            actions={<SectionViewLink to={`/agents/${agent.id}/edit?step=4`} label="Subscriptions" />}
          >
            Subscriptions ({subs.length})
          </SectionHeader>
          {subs.length === 0 ? (
            <EmptyHint text="No event subscriptions" />
          ) : (
            <div className="divide-y divide-surface-border/30">
              {subs.map((sub: any) => (
                <div key={sub.id} className="flex items-center py-2">
                  <div className="flex-1 min-w-0"><EventTopicPill topic={sub.topic} /></div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-text-quaternary text-[10px]">→</span>
                    <WorkflowPill
                      type={sub.reaction_type === 'capability' ? sub.tool_name : sub.workflow_type || sub.reaction_type}
                      variant={sub.reaction_type === 'pipeline' ? 'pipeline' : sub.reaction_type === 'capability' ? 'capability' : 'durable'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Col 2: Schedules */}
        <div>
          <SectionHeader
            icon={Clock}
            color="text-amber-400"
            actions={<SectionViewLink to={`/agents/${agent.id}/edit?step=5`} label="Schedules" />}
          >Schedules ({schedCount})</SectionHeader>
          {schedules?.length ? (
            <div className="divide-y divide-surface-border/30">
              {schedules.map((s: any, i: number) => (
                <div key={i} className="flex items-center py-2">
                  <div className="flex-1 min-w-0"><CronLabel cron={s.cron} /></div>
                  <div className="flex items-center gap-1.5 shrink-0"><span className="text-text-quaternary text-[10px]">→</span><WorkflowPill type={s.workflow_type || 'workflow'} /></div>
                </div>
              ))}
            </div>
          ) : legacyCron ? (
            <div className="flex items-center py-1">
              <div className="flex-1 min-w-0"><CronLabel cron={legacyCron} /></div>
              {agent.workflow_type && <div className="flex items-center gap-1.5 shrink-0"><span className="text-text-quaternary text-[10px]">→</span><WorkflowPill type={agent.workflow_type} /></div>}
            </div>
          ) : (
            <EmptyHint text="No schedules configured" />
          )}
        </div>

        {/* Col 3: Knowledge + Activity */}
        <div className="space-y-10">
          <div>
            <SectionHeader
              icon={Brain}
              color="text-emerald-400"
              actions={
                <SectionViewLink
                  to={agent.knowledge_domain ? `/knowledge?domain=${agent.knowledge_domain}` : `/agents/${agent.id}/edit?step=3`}
                  label="Knowledge"
                />
              }
            >Knowledge</SectionHeader>
            {agent.knowledge_domain ? (
              <button onClick={() => navigate(`/knowledge?domain=${agent.knowledge_domain}`)} className="group text-left flex items-center gap-3">
                <span className="text-sm font-mono text-text-primary group-hover:text-accent transition-colors">{agent.knowledge_domain}</span>
                <span className="text-[10px] text-text-quaternary">{agent.stats?.knowledge_count?.toLocaleString() ?? 0} entries</span>
                <ArrowRight className="w-3 h-3 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <EmptyHint text="No knowledge domain" />
            )}
          </div>

          <div>
            <SectionHeader icon={Radio} color="text-cyan-400"
              actions={
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${pulse ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  <span className="text-[10px] text-text-quaternary">live</span>
                </div>
              }
            >
              Activity
            </SectionHeader>
            {liveEvents.length === 0 ? (
              <EmptyHint text="Events appear here as the agent runs" />
            ) : (
              <div className="space-y-1.5">
                {liveEvents.map((ev) => (
                  <div key={ev.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-text-primary font-mono truncate flex-1">{ev.label || '—'}</span>
                      <span className="text-[10px] text-text-quaternary shrink-0 ml-2">{formatTime(ev.timestamp)}</span>
                    </div>
                    <EventTopicPill topic={ev.type} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
