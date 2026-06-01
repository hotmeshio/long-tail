import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Radio, Bot, Tag, Pencil, Trash2, Save, X, BookOpen, Send } from 'lucide-react';
import { useTopic, useUpdateTopic, useDeleteTopic, usePublishTopic } from '../../api/topics';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { DateValue } from '../../components/common/display/DateValue';
import { ListToolbar } from '../../components/common/data/ListToolbar';

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
      <h2 className="text-xs font-semibold uppercase tracking-widest text-accent/80">{children}</h2>
    </div>
  );
}

export function TopicDetailPage() {
  const { topic: encodedTopic } = useParams<{ topic: string }>();
  const topicKey = encodedTopic ? decodeURIComponent(encodedTopic) : null;
  const navigate = useNavigate();
  const { data: topic, isLoading, refetch, isFetching } = useTopic(topicKey);
  const updateMutation = useUpdateTopic();
  const deleteMutation = useDeleteTopic();
  const publishMutation = usePublishTopic();

  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishPayload, setPublishPayload] = useState('');
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
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Radio className="w-5 h-5 text-accent" strokeWidth={1.5} />
            <h1 className="text-lg font-mono font-medium text-text-primary">{topic.topic}</h1>
            <button onClick={() => { window.location.hash = '#docs:topics.md'; }} className="text-text-quaternary hover:text-accent transition-colors" title="Topic docs">
              <BookOpen className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${categoryPillCls}`}>{topic.category}</span>
            <span className="text-[10px] font-mono text-text-quaternary">source: {topic.source}</span>
            {topic.last_seen_at && (
              <span className="text-[10px] text-text-quaternary">last seen <DateValue date={topic.last_seen_at} /></span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ListToolbar
            onRefresh={() => refetch()}
            isFetching={isFetching}
            apiPath={`/topics/by-name/${encodeURIComponent(topic.topic)}`}
          />
          {!editing && (
            <button
              onClick={() => {
                const payload = topic.example_payload
                  ? JSON.stringify(topic.example_payload, null, 2)
                  : topic.payload_schema?.properties
                    ? JSON.stringify(Object.fromEntries(Object.keys(topic.payload_schema.properties).map(k => [k, ''])), null, 2)
                    : '{}';
                setPublishPayload(payload);
                setPublishing(!publishing);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${publishing ? 'bg-accent/10 text-accent' : 'text-text-tertiary hover:text-accent hover:bg-surface-hover'}`}
            >
              <Send className="w-3 h-3" /> Publish
            </button>
          )}
          {!editing && editable && (
            <>
              <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
              {!isSystem && (
                <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-600/10 transition-colors">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </>
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

      {/* Publish panel */}
      {publishing && (
        <div className="mb-6 bg-surface-sunken/50 rounded-md p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-accent/60 mb-2">Publish test event</p>
          <textarea
            value={publishPayload}
            onChange={(e) => setPublishPayload(e.target.value)}
            className="input-json w-full text-xs"
            rows={6}
            spellCheck={false}
            placeholder='{ "key": "value" }'
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => {
                try {
                  const data = JSON.parse(publishPayload);
                  publishMutation.mutate({ topic: topic.topic, data }, {
                    onSuccess: () => setPublishing(false),
                  });
                } catch { /* invalid JSON */ }
              }}
              disabled={publishMutation.isPending}
              className="btn-primary text-xs"
            >
              {publishMutation.isPending ? 'Publishing...' : 'Publish'}
            </button>
            <button onClick={() => setPublishing(false)} className="text-xs text-text-tertiary hover:text-text-primary">Cancel</button>
            {publishMutation.isSuccess && <span className="text-xs text-status-success">Published</span>}
            {publishMutation.isError && <span className="text-xs text-status-error">{publishMutation.error.message}</span>}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="mb-8">
        {editing ? (
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
        ) : (
          topic.description
            ? <p className="text-sm text-text-secondary leading-relaxed">{topic.description}</p>
            : <p className="text-sm text-text-quaternary italic">No description</p>
        )}
      </div>

      {/* Tags */}
      <div className="mb-8">
        {editing ? (
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
        ) : topic.tags?.length > 0 ? (
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 text-text-quaternary" strokeWidth={1.5} />
            {topic.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-text-tertiary bg-surface-sunken">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Payload Schema */}
      <div className="mb-8">
        {editing ? (
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
            <p className="hint">JSON Schema describing the event.data shape. Shown in subscription editor as field reference.</p>
          </div>
        ) : topic.payload_schema ? (
          <>
            <SectionHeader icon={Radio} color="text-accent">Payload Schema</SectionHeader>
            <JsonViewer data={topic.payload_schema} />
          </>
        ) : (
          <>
            <SectionHeader icon={Radio} color="text-accent">Payload Schema</SectionHeader>
            <p className="text-[11px] text-text-quaternary">No schema defined. Click Edit to add one.</p>
          </>
        )}
      </div>

      {/* Example Payload */}
      {topic.example_payload && (
        <div className="mb-8">
          <SectionHeader icon={Radio} color="text-cyan-400">Example Payload</SectionHeader>
          <JsonViewer data={topic.example_payload} />
        </div>
      )}

      {/* Subscribers */}
      <div className="mb-8">
        <SectionHeader icon={Bot} color="text-emerald-400">
          Subscribers ({topic.subscribers?.length ?? 0})
        </SectionHeader>
        {topic.subscribers?.length ? (
          <div className="space-y-1">
            {topic.subscribers.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-surface-hover transition-colors">
                <button
                  onClick={() => navigate(`/agents/${sub.agent_id}`)}
                  className="flex items-center gap-2 text-left min-w-0"
                >
                  <Bot className="w-3 h-3 text-emerald-400 shrink-0" strokeWidth={1.5} />
                  <span className="text-xs text-text-primary hover:text-accent transition-colors">{sub.agent_name}</span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-text-quaternary">{sub.topic}</span>
                  <span className="text-[10px] text-text-tertiary">{sub.reaction_type}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-quaternary py-2">No agents are subscribed to this topic.</p>
        )}
      </div>

      {/* Metadata */}
      <div className="text-[10px] text-text-quaternary space-y-1 pt-4 border-t border-surface-border">
        <p>Created <DateValue date={topic.created_at} /></p>
        <p>Updated <DateValue date={topic.updated_at} /></p>
      </div>
    </div>
  );
}
