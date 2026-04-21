import { useState, useEffect } from 'react';
import { ConfigurationSection } from '../../../pages/mcp/mcp-query-detail/ConfigurationSection';
import { DagCanvas } from './DagCanvas';
import type { ActivityManifestEntry, InputFieldMeta } from '../../../api/types';

type ViewMode = 'design' | 'raw';

interface YamlComposerProps {
  yamlContent: string | undefined;
  activityManifest: ActivityManifestEntry[];
  inputSchema: Record<string, unknown> | undefined;
  outputSchema: Record<string, unknown> | undefined;
  // DAG selection — controlled by parent (DeployPanel owns the right sidebar)
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  // ConfigurationSection pass-through
  wf: any;
  configEditing: boolean;
  setConfigEditing: (v: boolean) => void;
  canEditConfig: boolean;
  yamlDraft: string;
  setYamlDraft: (v: string) => void;
  inputSchemaDraft: string;
  setInputSchemaDraft: (v: string) => void;
  outputSchemaDraft: string;
  setOutputSchemaDraft: (v: string) => void;
  inputFieldMetaDraft: InputFieldMeta[];
  setInputFieldMetaDraft: (v: InputFieldMeta[]) => void;
  onSave: () => void;
  onCancel: () => void;
  updateMutation: any;
  yamlTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function YamlComposer({
  activityManifest,
  inputSchema,
  outputSchema,
  yamlContent,
  selectedNodeId,
  onNodeSelect,
  wf,
  configEditing,
  setConfigEditing,
  canEditConfig,
  yamlDraft,
  setYamlDraft,
  inputSchemaDraft,
  setInputSchemaDraft,
  outputSchemaDraft,
  setOutputSchemaDraft,
  inputFieldMetaDraft,
  setInputFieldMetaDraft,
  onSave,
  onCancel,
  updateMutation,
  yamlTextareaRef,
}: YamlComposerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('design');

  // Force raw mode when editing config; clear selection
  useEffect(() => {
    if (configEditing) {
      setViewMode('raw');
      onNodeSelect(null);
    }
  }, [configEditing, onNodeSelect]);

  return (
    <div>
      {/* Mode toggle */}
      <div className="flex items-center gap-1 mb-4">
        <button
          onClick={() => {
            setViewMode('design');
          }}
          className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
            viewMode === 'design'
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Design
        </button>
        <button
          onClick={() => {
            setViewMode('raw');
            onNodeSelect(null);
          }}
          className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
            viewMode === 'raw'
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Raw
        </button>
      </div>

      {viewMode === 'design' ? (
        <DagCanvas
          manifest={activityManifest}
          selectedId={selectedNodeId}
          onSelect={onNodeSelect}
          yaml={yamlContent}
        />
      ) : (
        <ConfigurationSection
          wf={wf}
          resolvedInputSchema={inputSchema}
          resolvedOutputSchema={outputSchema}
          resolvedYaml={yamlContent}
          configEditing={configEditing}
          setConfigEditing={setConfigEditing}
          canEditConfig={canEditConfig}
          yamlDraft={yamlDraft}
          setYamlDraft={setYamlDraft}
          inputSchemaDraft={inputSchemaDraft}
          setInputSchemaDraft={setInputSchemaDraft}
          outputSchemaDraft={outputSchemaDraft}
          setOutputSchemaDraft={setOutputSchemaDraft}
          inputFieldMetaDraft={inputFieldMetaDraft}
          setInputFieldMetaDraft={setInputFieldMetaDraft}
          onSave={onSave}
          onCancel={onCancel}
          updateMutation={updateMutation}
          yamlTextareaRef={yamlTextareaRef}
          isCollapsed={false}
          onToggle={() => {}}
          schemasGrid
          unwrapped
        />
      )}
    </div>
  );
}
