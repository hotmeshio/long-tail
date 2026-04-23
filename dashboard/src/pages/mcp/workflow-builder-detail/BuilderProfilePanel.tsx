import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { TagInput } from '../../../components/common/form/TagInput';
import { useCreateDirectYamlWorkflow } from '../../../api/workflow-builder';
import { useYamlWorkflow, useUpdateYamlWorkflow } from '../../../api/yaml-workflows';

interface BuilderProfilePanelProps {
  builderData: any;
  resolvedYamlId: string | null;
  originalPrompt?: string;
  onBack: () => void;
  onCreate: (yamlId: string) => void;
  onNext: () => void;
}

export function BuilderProfilePanel({ builderData, resolvedYamlId, originalPrompt, onBack, onCreate, onNext }: BuilderProfilePanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState((builderData?.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const [description, setDescription] = useState(builderData?.description || '');
  const [appId, setAppId] = useState('longtail');
  const [tags, setTags] = useState<string[]>(builderData?.tags || []);

  const createYaml = useCreateDirectYamlWorkflow();
  const updateYaml = useUpdateYamlWorkflow();
  const { data: existingWf } = useYamlWorkflow(resolvedYamlId || '');

  const isCreated = !!resolvedYamlId;

  const handleCreate = async () => {
    const result = await createYaml.mutateAsync({
      name,
      description,
      yaml_content: builderData.yaml,
      input_schema: builderData.input_schema,
      activity_manifest: builderData.activity_manifest,
      tags,
      app_id: appId,
    });
    onCreate(result.id);
  };

  const handleSave = async () => {
    if (!resolvedYamlId) return;
    await updateYaml.mutateAsync({
      id: resolvedYamlId,
      name,
      description,
      tags,
    });
    setIsEditing(false);
  };

  const editable = !isCreated || isEditing;

  return (
    <div>
      <h2 className="text-2xl font-extralight tracking-wide text-accent/75 mb-1">Profile</h2>
      <p className="text-base text-text-secondary mb-6">
        Name the MCP server and tool, add tags for discovery, and describe what this pipeline does.
      </p>

      {/* Original prompt — context for filling in the profile fields */}
      {originalPrompt && (
        <div className="mb-6">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Original Prompt</label>
          <div className="rounded-md bg-surface-sunken/50 px-4 py-3">
            <p className="text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap">
              {originalPrompt}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[300px_1fr] gap-4 mb-6">
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">MCP Server Name</label>
            {editable ? (
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              />
            ) : (
              <p className="text-sm text-text-primary py-1.5">{existingWf?.app_id || appId}</p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">MCP Tool Name</label>
            {editable ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              />
            ) : (
              <p className="text-sm text-text-primary py-1.5">{existingWf?.name || name}</p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</label>
            {editable ? (
              <TagInput tags={tags} onChange={setTags} compact />
            ) : (
              <div className="flex flex-wrap gap-1.5 py-1">
                {(existingWf?.tags || tags).map((t: string) => (
                  <span key={t} className="px-2 py-0.5 text-sm bg-surface-raised text-text-primary rounded">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
            {isCreated && !isEditing && (
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
            <p className="text-sm text-text-primary leading-relaxed py-1.5">{existingWf?.description || description}</p>
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

      {createYaml.isError && (
        <p className="text-xs text-status-error mb-4">{createYaml.error.message}</p>
      )}

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        {!isCreated ? (
          <button
            onClick={handleCreate}
            disabled={createYaml.isPending || !name.trim()}
            className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createYaml.isPending ? 'Creating...' : 'Create & Save'}
          </button>
        ) : (
          <button onClick={onNext} className="btn-primary text-xs">
            Next: Deploy
          </button>
        )}
      </WizardNav>
    </div>
  );
}
