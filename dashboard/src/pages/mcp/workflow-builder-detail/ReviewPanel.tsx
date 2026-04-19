import { useState } from 'react';
import { FileCode, Layers, Tag } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { useCreateDirectYamlWorkflow } from '../../../api/workflow-builder';

interface ReviewPanelProps {
  builderData: any;
  onBack: () => void;
  onDeploy: (yamlId: string) => void;
}

export function ReviewPanel({ builderData, onBack, onDeploy }: ReviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'yaml' | 'schema' | 'manifest'>('yaml');
  const createYaml = useCreateDirectYamlWorkflow();

  if (!builderData?.yaml) {
    return (
      <div className="py-12 text-center text-text-tertiary text-sm">
        No workflow data available. Go back to the Describe step.
      </div>
    );
  }

  const handleDeploy = async () => {
    const result = await createYaml.mutateAsync({
      name: builderData.name,
      description: builderData.description,
      yaml_content: builderData.yaml,
      input_schema: builderData.input_schema,
      activity_manifest: builderData.activity_manifest,
      tags: builderData.tags,
      app_id: 'longtail',
    });
    onDeploy(result.id);
  };

  const tabs = [
    { key: 'yaml' as const, label: 'YAML', icon: FileCode },
    { key: 'schema' as const, label: 'Input Schema', icon: Layers },
    { key: 'manifest' as const, label: 'Manifest', icon: Tag },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <FileCode className="w-4 h-4 text-status-success" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold text-text-primary">Review</h2>
      </div>
      <p className="text-xs text-text-tertiary mb-4">
        Review the generated workflow before deploying.
      </p>

      <div className="mb-4">
        <p className="text-sm font-medium text-text-primary">{builderData.name}</p>
        <p className="text-xs text-text-tertiary mt-0.5">{builderData.description}</p>
        {builderData.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {builderData.tags.map((t: string) => (
              <span key={t} className="px-1.5 py-0.5 text-[10px] font-mono bg-surface-raised text-text-secondary rounded">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-3 border-b border-surface-border">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <Icon className="w-3 h-3" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-surface-border bg-surface-raised overflow-hidden">
        {activeTab === 'yaml' && (
          <pre className="p-4 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre max-h-[500px] overflow-y-auto">
            {builderData.yaml}
          </pre>
        )}
        {activeTab === 'schema' && (
          <div className="p-4">
            <JsonViewer data={builderData.input_schema} />
          </div>
        )}
        {activeTab === 'manifest' && (
          <div className="p-4 space-y-3">
            {(builderData.activity_manifest || []).map((a: any) => (
              <div key={a.activity_id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-text-primary">{a.activity_id}</span>
                  <span className="text-text-tertiary">{a.title}</span>
                  {a.mcp_tool_name && (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-surface-sunken text-text-secondary rounded">
                      {a.mcp_tool_name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {builderData.sample_inputs && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Sample Inputs</p>
          <JsonViewer data={builderData.sample_inputs} />
        </div>
      )}

      <WizardNav>
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          &larr; Describe
        </button>
        <button
          onClick={handleDeploy}
          disabled={createYaml.isPending}
          className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createYaml.isPending ? 'Creating...' : 'Create & Deploy'} &rarr;
        </button>
      </WizardNav>
    </div>
  );
}
