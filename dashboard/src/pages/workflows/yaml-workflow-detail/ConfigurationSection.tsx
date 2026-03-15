import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { JsonViewer } from '../../../components/common/data/JsonViewer';

export function ConfigurationSection({
  wf,
  resolvedInputSchema,
  resolvedOutputSchema,
  resolvedYaml,
  configEditing,
  setConfigEditing,
  canEditConfig,
  yamlDraft,
  setYamlDraft,
  inputSchemaDraft,
  setInputSchemaDraft,
  outputSchemaDraft,
  setOutputSchemaDraft,
  onSave,
  onCancel,
  updateMutation,
  yamlTextareaRef,
  isCollapsed,
  onToggle,
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
  onSave: () => void;
  onCancel: () => void;
  updateMutation: any;
  yamlTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isCollapsed: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <CollapsibleSection sectionKey="config" title="Configuration" isCollapsed={isCollapsed} onToggle={onToggle} >
      <div className="space-y-6">
        {/* Edit / Save / Cancel controls */}
        <div className="flex items-center justify-between">
          <a
            href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-accent hover:underline flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            YAML Guide
          </a>
          <div className="flex items-center gap-3">
            {canEditConfig && !configEditing && (
              <button
                onClick={() => { setConfigEditing(true); setTimeout(() => yamlTextareaRef.current?.focus(), 50); }}
                className="text-[10px] text-accent hover:underline"
              >
                Edit
              </button>
            )}
            {configEditing && (
              <>
                <button onClick={onCancel} className="text-[10px] text-text-tertiary hover:text-text-primary">
                  Cancel
                </button>
                <button
                  onClick={onSave}
                  disabled={updateMutation.isPending || (
                    yamlDraft === wf.yaml_content
                    && inputSchemaDraft === JSON.stringify(wf.input_schema, null, 2)
                    && outputSchemaDraft === JSON.stringify(wf.output_schema, null, 2)
                  )}
                  className="text-[10px] text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {updateMutation.error && (
          <p className="text-xs text-status-error">{updateMutation.error.message}</p>
        )}

        {/* Schemas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {configEditing ? (
            <>
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
                <textarea
                  value={inputSchemaDraft}
                  onChange={(e) => setInputSchemaDraft(e.target.value)}
                  className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                  rows={Math.max(inputSchemaDraft.split('\n').length + 1, 6)}
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                  spellCheck={false}
                />
              </div>
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output Schema</h4>
                <textarea
                  value={outputSchemaDraft}
                  onChange={(e) => setOutputSchemaDraft(e.target.value)}
                  className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                  rows={Math.max(outputSchemaDraft.split('\n').length + 1, 6)}
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                  spellCheck={false}
                />
              </div>
            </>
          ) : (
            <>
              <JsonViewer data={resolvedInputSchema ?? {}} label="Input Schema" />
              <JsonViewer data={resolvedOutputSchema ?? {}} label="Output Schema" />
            </>
          )}
        </div>

        {/* YAML Definition */}
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">YAML Definition</h4>
          {configEditing ? (
            <textarea
              ref={yamlTextareaRef}
              value={yamlDraft}
              onChange={(e) => setYamlDraft(e.target.value)}
              className="w-full p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
              rows={yamlDraft.split('\n').length + 1}
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              spellCheck={false}
            />
          ) : (
            <pre className="p-4 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
              {resolvedYaml ?? wf.yaml_content}
            </pre>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
