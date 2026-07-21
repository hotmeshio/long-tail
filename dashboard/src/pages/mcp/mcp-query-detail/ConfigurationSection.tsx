import { useState } from 'react';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { InputSchemaEditor } from './InputSchemaEditor';
import { YamlDefinitionSection } from './YamlDefinitionSection';
import { ActivityManifestSection } from './ActivityManifestSection';
import type { InputFieldMeta } from '../../../api/types';

export function ConfigurationSection({
  wf,
  resolvedInputSchema,
  resolvedOutputSchema,
  resolvedYaml,
  configEditing,
  setConfigEditing: _setConfigEditing,
  canEditConfig: _canEditConfig,
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
  isCollapsed,
  onToggle,
  schemasGrid,
  unwrapped,
}: {
  wf: any;
  resolvedInputSchema: any;
  resolvedOutputSchema: any;
  resolvedYaml: string | undefined;
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
  isCollapsed: boolean;
  onToggle: (key: string) => void;
  /** Render input/output schemas side-by-side in a 2-column grid. */
  schemasGrid?: boolean;
  /** Skip the CollapsibleSection wrapper and render content directly. */
  unwrapped?: boolean;
}) {
  const hasFieldMeta = inputFieldMetaDraft.length > 0;
  const [advancedMode, setAdvancedMode] = useState(false);

  const yamlText = configEditing ? yamlDraft : (resolvedYaml ?? wf.yaml_content);

  const content = (
      <div className="space-y-6">
        {/* Save / Cancel controls — only shown when NOT unwrapped (wizard handles its own) */}
        {!unwrapped && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {configEditing && hasFieldMeta && (
                <button
                  type="button"
                  onClick={() => setAdvancedMode(!advancedMode)}
                  className="text-2xs text-text-tertiary hover:text-text-primary"
                >
                  {advancedMode ? 'Visual editor' : 'Advanced (JSON)'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {configEditing && (
                <>
                  <button onClick={onCancel} className="text-2xs text-text-tertiary hover:text-text-primary">
                    Cancel
                  </button>
                  <button
                    onClick={onSave}
                    disabled={updateMutation.isPending || (
                      yamlDraft === wf.yaml_content
                      && inputSchemaDraft === JSON.stringify(wf.input_schema, null, 2)
                      && outputSchemaDraft === JSON.stringify(wf.output_schema, null, 2)
                    )}
                    className="text-2xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {/* Advanced mode toggle — shown even when unwrapped */}
        {unwrapped && configEditing && hasFieldMeta && (
          <div>
            <button
              type="button"
              onClick={() => setAdvancedMode(!advancedMode)}
              className="text-2xs text-text-tertiary hover:text-text-primary"
            >
              {advancedMode ? 'Visual editor' : 'Advanced (JSON)'}
            </button>
          </div>
        )}

        {updateMutation.error && (
          <p className="text-xs text-status-error">{updateMutation.error.message}</p>
        )}

        {/* Input + Output Schemas */}
        <div className={schemasGrid ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'space-y-6'}>
          {/* Input Schema */}
          <div>
            {configEditing && hasFieldMeta && !advancedMode ? (
              <>
                <h4 className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
                <InputSchemaEditor
                  fields={inputFieldMetaDraft}
                  onChange={setInputFieldMetaDraft}
                  editing={configEditing}
                />
              </>
            ) : configEditing ? (
              <>
                <h4 className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
                <textarea
                  value={inputSchemaDraft}
                  onChange={(e) => setInputSchemaDraft(e.target.value)}
                  className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                  rows={Math.max(inputSchemaDraft.split('\n').length + 1, 6)}
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                  spellCheck={false}
                />
              </>
            ) : (
              <JsonViewer data={resolvedInputSchema ?? {}} label="Input Schema" />
            )}
          </div>

          {/* Output Schema */}
          <div>
            {configEditing ? (
              <>
                <h4 className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output Schema</h4>
                <textarea
                  value={outputSchemaDraft}
                  onChange={(e) => setOutputSchemaDraft(e.target.value)}
                  className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                  rows={Math.max(outputSchemaDraft.split('\n').length + 1, 6)}
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                  spellCheck={false}
                />
              </>
            ) : (
              <JsonViewer data={resolvedOutputSchema ?? {}} label="Output Schema" />
            )}
          </div>
        </div>

        {/* YAML Definition */}
        <YamlDefinitionSection
          yamlText={yamlText}
          configEditing={configEditing}
          yamlDraft={yamlDraft}
          setYamlDraft={setYamlDraft}
          yamlTextareaRef={yamlTextareaRef}
        />

        {/* Activity Manifest */}
        {wf.activity_manifest?.length > 0 && (
          <ActivityManifestSection manifest={wf.activity_manifest} />
        )}
      </div>
  );

  if (unwrapped) return content;

  return (
    <CollapsibleSection sectionKey="config" title="Configuration" isCollapsed={isCollapsed} onToggle={onToggle}>
      {content}
    </CollapsibleSection>
  );
}
