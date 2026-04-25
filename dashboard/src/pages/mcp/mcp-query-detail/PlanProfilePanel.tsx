import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';

import { TagInput } from '../../../components/common/form/TagInput';
import { useYamlWorkflow, useUpdateYamlWorkflow } from '../../../api/yaml-workflows';
import type { PlanItem } from '../../../api/types';

interface PlanProfilePanelProps {
  yamlId: string;
  planItem: PlanItem;
  lockedAppId: string | null;
  isSaved: boolean;
  onSaved: (appId: string) => void;
  onNavigateDeploy: () => void;
}

export function PlanProfilePanel({ yamlId, planItem, lockedAppId, isSaved, onSaved, onNavigateDeploy }: PlanProfilePanelProps) {
  const { data: wf } = useYamlWorkflow(yamlId);
  const updateYaml = useUpdateYamlWorkflow();

  const [appId, setAppId] = useState(lockedAppId || 'longtail');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Re-initialize when switching workflows (yamlId changes) or data arrives
  useEffect(() => {
    if (wf && wf.id !== loadedId) {
      setAppId(lockedAppId || wf.app_id || 'longtail');
      const defaultName = planItem.name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '');
      setName((wf.name !== defaultName && wf.name) ? wf.name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '') : defaultName);
      setDescription(wf.description || planItem.description || '');
      setTags(wf.tags || []);
      setLoadedId(wf.id);
      setIsEditing(false);
    }
  }, [wf, planItem, lockedAppId, loadedId]);

  // Keep appId in sync with lock changes
  useEffect(() => {
    if (lockedAppId) setAppId(lockedAppId);
  }, [lockedAppId]);

  const handleSave = async () => {
    if (!wf) return;
    const sanitizedAppId = appId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '');

    // Always rewrite YAML to align app.id, subscribes, topic, and activity suffixes
    let yaml = wf.yaml_content || '';

    // Extract the actual subscribes value from the YAML (source of truth)
    const subscribesMatch = yaml.match(/^\s*-?\s*subscribes:\s*(.+)$/m);
    const actualOldTopic = subscribesMatch ? subscribesMatch[1].trim() : wf.graph_topic;

    // 1. Rewrite app.id
    yaml = yaml.replace(/^(\s*id:\s*)(.+)$/m, `$1${sanitizedAppId}`);

    // 2. Rewrite subscribes
    yaml = yaml.replace(/^(\s*-?\s*subscribes:\s*)(.+)$/m, `$1${sanitizedName}`);

    // 3. Rewrite all worker topic fields that match the old subscribes value
    if (actualOldTopic) {
      yaml = yaml.replace(
        new RegExp(`^(\\s*topic:\\s*)${actualOldTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'gm'),
        `$1${sanitizedName}`,
      );
    }

    // 4. Replace activity ID suffixes with a fresh unique 4-char suffix.
    // Activity IDs are defined as YAML keys at 8-space indent: "        trigger_x8kf:"
    // First, collect all actual activity IDs from their definitions.
    const newSuffix = Math.random().toString(36).slice(2, 6);
    const activityIds = [...yaml.matchAll(/^ {8}(\w+_[a-z0-9]{4}):\s*$/gm)].map(m => m[1]);
    for (const actId of activityIds) {
      // Replace this exact activity ID everywhere it appears (definitions + references)
      const newId = actId.replace(/_[a-z0-9]{4}$/, `_${newSuffix}`);
      if (actId !== newId) {
        yaml = yaml.replace(new RegExp(actId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newId);
      }
    }

    await updateYaml.mutateAsync({
      id: yamlId,
      name: sanitizedName,
      description,
      tags,
      app_id: sanitizedAppId,
      graph_topic: sanitizedName,
      yaml_content: yaml,
    });
    setIsEditing(false);
    onSaved(sanitizedAppId);
  };

  if (!wf) {
    return <div className="text-sm text-text-tertiary py-8 text-center">Loading workflow...</div>;
  }

  const saved = isSaved && !isEditing;
  const editable = !isSaved || isEditing;
  const isLocked = !!lockedAppId;

  return (
    <div>
      <h2 className="text-2xl font-extralight tracking-wide text-accent/75 mb-1">Profile</h2>
      <p className="text-base text-text-secondary mb-6">
        Configure the MCP server and tool identity for <span className="font-medium text-text-primary">{planItem.name}</span>.
      </p>

      <div className="grid grid-cols-[300px_1fr] gap-4 mb-6">
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">MCP Server Name</label>
            {editable && !isLocked ? (
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                placeholder="lowercase alphanumeric only"
              />
            ) : (
              <p className="text-sm font-mono text-text-primary py-1.5">{wf.app_id || appId}</p>
            )}
            {isLocked && editable && (
              <p className="text-[10px] text-text-tertiary mt-1">Locked to match other workflows in this set.</p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">MCP Tool Name</label>
            {editable ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                placeholder="unique tool name (dashes allowed)"
              />
            ) : (
              <p className="text-sm font-mono text-text-primary py-1.5">{wf.name || name}</p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</label>
            {editable ? (
              <TagInput tags={tags} onChange={setTags} compact />
            ) : (
              <div className="flex flex-wrap gap-1.5 py-1">
                {(wf.tags || tags).map((t: string) => (
                  <span key={t} className="px-2 py-0.5 text-sm bg-surface-raised text-text-primary rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
            {saved && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors"
              >
                <Pencil className="w-3 h-3" strokeWidth={1.5} />
                Edit
              </button>
            )}
          </div>
          {editable ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full flex-1 min-h-[100px] bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs font-mono text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
            />
          ) : (
            <p className="text-sm text-text-primary leading-relaxed py-1.5">{wf.description || description}</p>
          )}
          {isEditing && (
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setIsEditing(false)} className="text-[10px] text-text-tertiary hover:text-text-primary">Cancel</button>
              <button
                onClick={handleSave}
                disabled={updateYaml.isPending}
                className="text-[10px] text-accent hover:text-accent/80 font-medium"
              >
                {updateYaml.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {updateYaml.isError && (
        <p className="text-xs text-status-error mb-4">{updateYaml.error.message}</p>
      )}

      <div className="flex justify-end">
        {saved ? (
          <button onClick={onNavigateDeploy} className="btn-primary text-xs">
            Next: Deploy
          </button>
        ) : !isEditing ? (
          <button
            onClick={handleSave}
            disabled={updateYaml.isPending || !name.trim() || !appId.trim()}
            className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateYaml.isPending ? 'Saving...' : 'Save Profile'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
