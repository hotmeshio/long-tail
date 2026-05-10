import { useState } from 'react';
import { Layers, X, Pencil, Check } from 'lucide-react';
import { SecondaryAction } from '../../../components/common/display/SecondaryAction';
import { useQueryClient } from '@tanstack/react-query';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { TagInput } from '../../../components/common/form/TagInput';
import { useUpdateYamlWorkflow } from '../../../api/yaml-workflows';
import { PanelTitle } from './PanelTitle';

export interface ExistingProfileViewProps {
  compiledYaml: any;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Read-only view of an already-compiled workflow profile (step 3, existing path)
 * with inline editing for description and tags.
 */
export function ExistingProfileView({ compiledYaml, onBack, onNext }: ExistingProfileViewProps) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateYamlWorkflow();
  const [editing, setEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(compiledYaml.description || '');
  const [tagsDraft, setTagsDraft] = useState<string[]>(compiledYaml.tags || []);

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      id: compiledYaml.id,
      description: descDraft.trim(),
      tags: tagsDraft,
    });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    setEditing(false);
  };

  const handleCancel = () => {
    setDescDraft(compiledYaml.description || '');
    setTagsDraft(compiledYaml.tags || []);
    setEditing(false);
  };

  return (
    <div>
      <PanelTitle
        title="Compile"
        subtitle="Compiled deterministic pipeline — name, tags, and deployment target"
        icon={Layers}
        iconClass="text-status-success"
        actions={!editing ? (
          <SecondaryAction icon={Pencil} label="Edit Profile" onClick={() => setEditing(true)} />
        ) : (
          <>
            <SecondaryAction icon={X} label="Cancel" onClick={handleCancel} />
            <SecondaryAction icon={Check} label={updateMutation.isPending ? 'Saving...' : 'Save'} onClick={handleSave} disabled={updateMutation.isPending} />
          </>
        )}
      />

      <div className="flex gap-6 mb-6">
        {/* Col 1 (~30%): namespace, tool name */}
        <div className="w-[30%] shrink-0 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Namespace</p>
            <p className="text-sm text-text-primary">{compiledYaml.app_id || '\u2014'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Tool Name</p>
            <p className="text-sm text-text-primary">{compiledYaml.name}</p>
          </div>
        </div>

        {/* Col 2 (~70%): description, tags, pipeline */}
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Description</p>
            {editing ? (
              <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
                className="w-full min-h-[80px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
            ) : (
              <p className="text-sm text-text-secondary leading-relaxed">{compiledYaml.description || '\u2014'}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</p>
            {editing ? (
              <TagInput tags={tagsDraft} onChange={setTagsDraft} placeholder="Add tags..." />
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {(compiledYaml.tags as string[] || []).length > 0 ? (
                  (compiledYaml.tags as string[]).map((tag: string) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-sunken text-text-secondary">{tag}</span>
                  ))
                ) : (
                  <span className="text-[10px] text-text-tertiary">No tags</span>
                )}
              </div>
            )}
          </div>
          {compiledYaml.activity_manifest?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Pipeline</p>
              <div className="flex items-center gap-1 flex-wrap">
                {(compiledYaml.activity_manifest as any[])
                  .filter((a: any) => a.tool_source !== 'trigger')
                  .map((a: any, i: number, arr: any[]) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-surface-sunken font-mono text-text-primary">{a.mcp_tool_name || a.title}</span>
                      {i < arr.length - 1 && <span className="text-text-tertiary text-[10px]">{'\u2192'}</span>}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        {compiledYaml.status !== 'active'
          ? <button onClick={onNext} className="btn-primary text-xs">Next: Deploy</button>
          : <button onClick={onNext} className="btn-primary text-xs">Next: Test</button>}
      </WizardNav>
    </div>
  );
}
