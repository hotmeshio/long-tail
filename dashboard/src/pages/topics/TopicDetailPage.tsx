import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Radio, Bot, Tag, Pencil, Trash2, Save, X, BookOpen, Send, FlaskConical, Info, Braces } from 'lucide-react';
import { useTopic, useUpdateTopic, useDeleteTopic, usePublishTopic } from '../../api/topics';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { DateValue } from '../../components/common/display/DateValue';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { useSettings } from '../../api/settings';

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

function SectionHeader({ icon: Icon, color, children }: { icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-surface-border">
      <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
      <h2 className="section-h2">{children}</h2>
    </div>
  );
}

export function TopicDetailPage() {
  const { topic: encodedTopic } = useParams<{ topic: string }>();
  const topicKey = encodedTopic ? decodeURIComponent(encodedTopic) : null;
  const navigate = useNavigate();
  const { data: topic, isLoading, refetch, isFetching } = useTopic(topicKey);
  const { data: settings } = useSettings();
  const subscriberLabel = settings?.ai?.enabled ? 'agents' : 'automations';
  const updateMutation = useUpdateTopic();
  const deleteMutation = useDeleteTopic();
  const publishMutation = usePublishTopic();

  const [editing, setEditing] = useState(false);
  const [publishSubject, setPublishSubject] = useState('');
  const [publishEventId, setPublishEventId] = useState(() => `evt-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
  const [publishPayload, setPublishPayload] = useState('');
  // Opt-in envelope extension fields. Which ones are shown depends on the topic
  // family (system.workflow.* shows workflow fields; a custom/file topic shows
  // none). Prefilled like Event ID; sent as top-level event fields.
  const [publishWorkflowName, setPublishWorkflowName] = useState('myWorkflow');
  const [publishWorkflowId, setPublishWorkflowId] = useState('wf-001');
  const [publishTaskQueue, setPublishTaskQueue] = useState('default');
  const [publishStatus, setPublishStatus] = useState('');
  const [publishEscalationId, setPublishEscalationId] = useState('esc-001');
  const [publishActivityName, setPublishActivityName] = useState('myActivity');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editSchema, setEditSchema] = useState('');
  const [schemaError, setSchemaError] = useState('');

  if (isLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-surface-sunken rounded w-48" /><div className="h-40 bg-surface-sunken rounded" /></div>;
  }

  if (!topic) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Radio className="w-12 h-12 text-text-quaternary mb-4" strokeWidth={1} />
        <h2 className="text-lg font-medium text-text-primary mb-2">Topic not found</h2>
      </div>
    );
  }

  const isSystem = topic.source === 'system';
  const isManaged = topic.managed;
  const editable = !isManaged;
  const categoryPillCls = CATEGORY_COLORS[topic.category] ?? 'bg-zinc-400/15 text-zinc-400';

  const defaultPayload = topic.example_payload
    ? JSON.stringify(topic.example_payload, null, 2)
    : topic.payload_schema?.properties
      ? JSON.stringify(Object.fromEntries(Object.keys(topic.payload_schema.properties).map(k => [k, ''])), null, 2)
      : '{}';

  // Which envelope extensions belong to this topic's family ("the system injects
  // fields by type"). Custom / file / knowledge topics carry none — just data.
  const fam =
    topic.topic.startsWith('system.workflow.') || topic.topic.startsWith('system.task.') ? 'workflow'
      : topic.topic.startsWith('system.escalation.') ? 'escalation'
        : topic.topic.startsWith('system.activity.') ? 'activity'
          : 'none';
  const showWorkflowFields = fam === 'workflow' || fam === 'escalation' || fam === 'activity';
  const showStatus = fam === 'workflow' || fam === 'escalation';
  // Status default mirrors the subject's terminal verb (failed / completed / resolved …).
  const statusDefault = (publishSubject || topic.topic).split('.').pop() ?? '';

  // The literal event the publish will send — built from the universal envelope
  // (id, subject, source) + only the family's extension fields + the payload.
  const buildPublishEvent = (): Record<string, any> => {
    let data: Record<string, any> = {};
    try { data = JSON.parse(publishPayload || defaultPayload); } catch { /* invalid JSON */ }
    const subject = (publishSubject || topic.topic) !== topic.topic ? (publishSubject || topic.topic) : undefined;
    const event: Record<string, any> = { id: publishEventId || undefined, source: 'dashboard', data };
    if (subject) event.subject = subject;
    if (showWorkflowFields) {
      event.workflowName = publishWorkflowName;
      event.workflowId = publishWorkflowId;
      event.taskQueue = publishTaskQueue;
    }
    if (showStatus) event.status = publishStatus || statusDefault;
    if (fam === 'escalation') event.escalationId = publishEscalationId;
    if (fam === 'activity') event.activityName = publishActivityName;
    return event;
  };
  // A literal preview of the published envelope (type derived from subject).
  const eventPreview = (() => {
    const { subject, ...rest } = buildPublishEvent();
    return JSON.stringify({ type: subject || topic.topic, timestamp: '<minted>', ...rest }, null, 2);
  })();
  if (!publishPayload && defaultPayload !== '{}') {
    setPublishPayload(defaultPayload);
  }
  if (!publishSubject) {
    setPublishSubject(topic.topic);
  }

  const startEdit = () => {
    setEditDescription(topic.description ?? '');
    setEditTags((topic.tags ?? []).join(', '));
    setEditSchema(topic.payload_schema ? JSON.stringify(topic.payload_schema, null, 2) : '');
    setSchemaError('');
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = () => {
    const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
    let payload_schema: Record<string, any> | undefined;
    if (editSchema.trim()) {
      try {
        payload_schema = JSON.parse(editSchema);
        setSchemaError('');
      } catch {
        setSchemaError('Invalid JSON');
        return;
      }
    }
    updateMutation.mutate(
      { topic: topic.topic, description: editDescription, tags, ...(payload_schema !== undefined ? { payload_schema } : {}) },
      { onSuccess: () => { setEditing(false); refetch(); } },
    );
  };

  const handleDelete = () => {
    if (confirm(`Delete topic "${topic.topic}"?\n\nThis removes it from the catalog. Active subscriptions are not affected.`)) {
      deleteMutation.mutate(topic.topic, { onSuccess: () => navigate('/topics') });
    }
  };

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Radio className="w-5 h-5 text-accent" strokeWidth={1.5} />
            <h1 className="text-lg font-mono font-medium text-text-primary">{topic.topic}</h1>
            <button onClick={() => { window.location.hash = '#docs:topics.md'; }} className="text-text-quaternary hover:text-accent transition-colors" title="Topic docs">
              <BookOpen className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
          {!editing && topic.description ? (
            <p className="text-sm text-text-secondary leading-relaxed">{topic.description}</p>
          ) : !editing ? (
            <p className="text-sm text-text-quaternary italic">No description</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!editing && editable && (
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
              <Pencil className="w-3 h-3" /> Edit
            </button>
          )}
          {!editing && !isSystem && editable && (
            <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-600/10 transition-colors">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
          {editing && (
            <>
              <button onClick={saveEdit} disabled={updateMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
                <Save className="w-3 h-3" /> Save
              </button>
              <button onClick={cancelEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Details band ─────────────────────────────────────────── */}
      <div className="bg-surface-sunken/50 rounded-md px-5 py-3 flex flex-wrap gap-x-6 gap-y-3 items-start mb-5 relative">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Category</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${categoryPillCls}`}>{topic.category}</span>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Source</p>
          <span className="text-xs font-mono text-text-secondary">{topic.source}</span>
        </div>
        {topic.tags?.length > 0 && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</p>
            <div className="flex items-center gap-1.5">
              <Tag className="w-2.5 h-2.5 text-text-quaternary" strokeWidth={1.5} />
              {topic.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-text-tertiary bg-surface-sunken">{tag}</span>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Created</p>
          <span className="text-xs text-text-secondary"><DateValue date={topic.created_at} /></span>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Updated</p>
          <span className="text-xs text-text-secondary"><DateValue date={topic.updated_at} /></span>
        </div>
        {topic.last_seen_at && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Last Seen</p>
            <span className="text-xs text-text-secondary"><DateValue date={topic.last_seen_at} /></span>
          </div>
        )}
        <div className="ml-auto self-center">
          <ListToolbar onRefresh={() => refetch()} isFetching={isFetching} apiPath={`/topics/by-name/${encodeURIComponent(topic.topic)}`} />
        </div>
      </div>

      {/* ── Three-column layout: Schema | Example | Test ─── */}
      {!editing && (
        <div className="grid grid-cols-3 gap-5">
          {/* Col 1 — Payload Schema */}
          <div className="min-w-0">
            <SectionHeader icon={Radio} color="text-accent">Payload Schema</SectionHeader>
            {topic.payload_schema ? (
              <JsonViewer data={topic.payload_schema} />
            ) : (
              <p className="text-[11px] text-text-quaternary">No schema defined. Click Edit to add one.</p>
            )}
          </div>

          {/* Col 2 — Example Payload */}
          <div className="min-w-0">
            <SectionHeader icon={Braces} color="text-cyan-400">Example Payload</SectionHeader>
            {topic.example_payload ? (
              <JsonViewer data={topic.example_payload} />
            ) : (
              <p className="text-[11px] text-text-quaternary">No example defined. Click Edit to add one.</p>
            )}
          </div>

          {/* Col 3 — Test */}
          <div className="min-w-0 space-y-4 animate-page-enter">
            <SectionHeader icon={FlaskConical} color="text-violet-400">Test</SectionHeader>
            {/* Target Subscribers */}
            <div className="bg-surface-sunken/30 rounded-md px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.5} />
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                  Target Subscribers
                </h2>
                <span className="relative group ml-auto">
                  <Info className="w-3 h-3 text-text-quaternary cursor-help" strokeWidth={1.5} />
                  <span className="absolute right-0 top-full mt-1 w-48 p-2 rounded bg-surface-raised border border-surface-border shadow-lg text-[10px] text-text-secondary leading-relaxed hidden group-hover:block z-10">
                    Publishing a test event is live — these subscribers will receive and process the payload.
                  </span>
                </span>
              </div>
              {topic.subscribers?.length ? (
                <div className="space-y-0.5">
                  {topic.subscribers.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => navigate(`/agents/${sub.agent_id}`)}
                      className="flex items-center gap-2 w-full text-left py-1 rounded hover:bg-surface-hover/50 transition-colors"
                    >
                      <Bot className="w-2.5 h-2.5 text-emerald-400 shrink-0" strokeWidth={1.5} />
                      <span className="text-[11px] text-text-primary hover:text-accent transition-colors truncate">{sub.agent_name}</span>
                      <span className="text-[9px] font-mono text-text-quaternary ml-auto shrink-0">{sub.reaction_type}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-text-quaternary">No {subscriberLabel} subscribed.</p>
              )}
            </div>

            {/* Publish */}
            <div className="sticky top-16 bg-surface-sunken/40 rounded-md p-4">
              <div className="flex items-center gap-2 mb-3">
                <Send className="w-3.5 h-3.5 text-accent" strokeWidth={1.5} />
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Publish</h2>
              </div>
              <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Event ID</label>
              <input
                value={publishEventId}
                onChange={(e) => setPublishEventId(e.target.value)}
                className="input w-full text-[11px] font-mono mb-3"
                spellCheck={false}
                placeholder="evt-1720368000000-a3f2"
              />
              <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Subject</label>
              <input
                value={publishSubject || topic.topic}
                onChange={(e) => setPublishSubject(e.target.value)}
                className="input w-full text-[11px] font-mono mb-3"
                spellCheck={false}
              />
              {showWorkflowFields && (
                <div className="grid grid-cols-2 gap-x-3">
                  <div>
                    <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Workflow Name</label>
                    <input
                      value={publishWorkflowName}
                      onChange={(e) => setPublishWorkflowName(e.target.value)}
                      className="input w-full text-[11px] font-mono mb-3"
                      spellCheck={false}
                      placeholder="myWorkflow"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Workflow ID</label>
                    <input
                      value={publishWorkflowId}
                      onChange={(e) => setPublishWorkflowId(e.target.value)}
                      className="input w-full text-[11px] font-mono mb-3"
                      spellCheck={false}
                      placeholder="wf-001"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Task Queue</label>
                    <input
                      value={publishTaskQueue}
                      onChange={(e) => setPublishTaskQueue(e.target.value)}
                      className="input w-full text-[11px] font-mono mb-3"
                      spellCheck={false}
                      placeholder="default"
                    />
                  </div>
                  {showStatus && (
                    <div>
                      <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Status</label>
                      <input
                        value={publishStatus || statusDefault}
                        onChange={(e) => setPublishStatus(e.target.value)}
                        className="input w-full text-[11px] font-mono mb-3"
                        spellCheck={false}
                        placeholder={statusDefault}
                      />
                    </div>
                  )}
                  {fam === 'escalation' && (
                    <div>
                      <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Escalation ID</label>
                      <input
                        value={publishEscalationId}
                        onChange={(e) => setPublishEscalationId(e.target.value)}
                        className="input w-full text-[11px] font-mono mb-3"
                        spellCheck={false}
                        placeholder="esc-001"
                      />
                    </div>
                  )}
                  {fam === 'activity' && (
                    <div>
                      <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Activity Name</label>
                      <input
                        value={publishActivityName}
                        onChange={(e) => setPublishActivityName(e.target.value)}
                        className="input w-full text-[11px] font-mono mb-3"
                        spellCheck={false}
                        placeholder="myActivity"
                      />
                    </div>
                  )}
                </div>
              )}
              <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1">Payload</label>
              <textarea
                value={publishPayload || defaultPayload}
                onChange={(e) => setPublishPayload(e.target.value)}
                className="input-json w-full text-[11px]"
                rows={6}
                spellCheck={false}
                placeholder='{ "key": "value" }'
              />
              <label className="block text-[10px] text-text-quaternary uppercase tracking-wide mb-1 mt-3">Event Preview</label>
              <pre className="bg-surface-sunken/60 rounded px-2 py-2 text-[10px] font-mono text-text-tertiary overflow-auto max-h-44 whitespace-pre">{eventPreview}</pre>
              <div className="mt-3">
                <button
                  onClick={() => {
                    publishMutation.mutate(
                      { topic: topic.topic, event: buildPublishEvent() },
                      { onSuccess: () => {
                        refetch();
                        // Generate a fresh event ID for the next publish
                        setPublishEventId(`evt-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
                      } },
                    );
                  }}
                  disabled={publishMutation.isPending}
                  className="btn-primary text-xs w-full"
                >
                  {publishMutation.isPending ? 'Publishing…' : 'Publish'}
                </button>
              </div>
              {publishMutation.isSuccess && (
                <p className="text-[10px] text-status-success mt-2 animate-page-enter">Event published</p>
              )}
              {publishMutation.isError && (
                <p className="text-[10px] text-status-error mt-2">{publishMutation.error.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit mode ────────────────────────────────────────────── */}
      {editing && (
        <div className="space-y-6 max-w-3xl">
          <div>
            <label className="section-header">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="What this topic represents"
            />
          </div>
          <div>
            <label className="section-header">Tags</label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="lifecycle, core, error"
              className="input font-mono"
            />
            <p className="hint">Comma-separated. Used for filtering in the catalog.</p>
          </div>
          <div>
            <label className="section-header">Payload Schema</label>
            <textarea
              value={editSchema}
              onChange={(e) => { setEditSchema(e.target.value); setSchemaError(''); }}
              rows={12}
              className="input-json w-full"
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "orderId": { "type": "string" }\n  }\n}'}
            />
            {schemaError && <p className="text-[10px] text-red-400 mt-1">{schemaError}</p>}
            <p className="hint">JSON Schema describing the event.data shape.</p>
          </div>
        </div>
      )}
    </div>
  );
}
