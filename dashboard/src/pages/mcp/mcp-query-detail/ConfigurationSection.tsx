import { useState, useRef, useCallback } from 'react';
import { Maximize2, Minimize2, Copy, Check, BookOpen } from 'lucide-react';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { FullscreenOverlay } from '../../../components/common/layout/FullscreenOverlay';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { InputSchemaEditor } from './InputSchemaEditor';
import type { InputFieldMeta } from '../../../api/types';

const ICON = 'w-3 h-3';
const BTN = 'p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised/60 transition-colors duration-150';
const BTN_LG = 'p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150';

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
  const [yamlFullscreen, setYamlFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const yamlSectionRef = useRef<HTMLDivElement>(null);

  const yamlText = configEditing ? yamlDraft : (resolvedYaml ?? wf.yaml_content);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yamlText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [yamlText]);

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
                  className="text-[10px] text-text-tertiary hover:text-text-primary"
                >
                  {advancedMode ? 'Visual editor' : 'Advanced (JSON)'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
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
        )}
        {/* Advanced mode toggle — shown even when unwrapped */}
        {unwrapped && configEditing && hasFieldMeta && (
          <div>
            <button
              type="button"
              onClick={() => setAdvancedMode(!advancedMode)}
              className="text-[10px] text-text-tertiary hover:text-text-primary"
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
          {/* Input Schema — visual editor when editing with field meta, JsonViewer otherwise */}
          <div>
            {configEditing && hasFieldMeta && !advancedMode ? (
              <>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
                <InputSchemaEditor
                  fields={inputFieldMetaDraft}
                  onChange={setInputFieldMetaDraft}
                  editing={configEditing}
                />
              </>
            ) : configEditing ? (
              <>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Input Schema</h4>
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
                <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Output Schema</h4>
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
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">YAML Definition</h4>
          <div ref={yamlSectionRef} className="relative">
            {/* Toolbar — inside the widget, upper right */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 bg-surface-sunken/90 rounded backdrop-blur-sm">
              <a
                href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
                target="_blank"
                rel="noopener noreferrer"
                className={BTN}
                title="YAML Guide"
              >
                <BookOpen className={ICON} />
              </a>
              <button onClick={handleCopyYaml} className={BTN} title="Copy YAML">
                {copied ? <Check className={`${ICON} text-status-success`} /> : <Copy className={ICON} />}
              </button>
              <button onClick={() => setYamlFullscreen(true)} className={BTN} title="Fullscreen">
                <Maximize2 className={ICON} />
              </button>
            </div>

            {configEditing ? (
              <textarea
                ref={yamlTextareaRef}
                value={yamlDraft}
                onChange={(e) => setYamlDraft(e.target.value)}
                className="w-full p-4 pr-28 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
                rows={yamlDraft.split('\n').length + 1}
                style={{ fieldSizing: 'content' } as React.CSSProperties}
                spellCheck={false}
              />
            ) : (
              <pre className="p-4 pr-28 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
                {resolvedYaml ?? wf.yaml_content}
              </pre>
            )}
          </div>
        </div>

        {/* YAML Fullscreen overlay — supports both view and edit modes */}
        <FullscreenOverlay open={yamlFullscreen} onClose={() => setYamlFullscreen(false)} sourceRef={yamlSectionRef}>
          <div className="sticky top-0 float-right z-10">
            <div className="flex items-center gap-0.5 bg-surface-sunken/80 rounded-md backdrop-blur-sm">
              <a
                href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
                target="_blank"
                rel="noopener noreferrer"
                className={BTN_LG}
                title="YAML Guide"
              >
                <BookOpen className="w-5 h-5" />
              </a>
              <button onClick={handleCopyYaml} className={BTN_LG} title="Copy YAML">
                {copied ? <Check className="w-5 h-5 text-status-success" /> : <Copy className="w-5 h-5" />}
              </button>
              <button onClick={() => setYamlFullscreen(false)} className={BTN_LG} title="Close (Esc)">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>
          </div>
          {configEditing ? (
            <textarea
              value={yamlDraft}
              onChange={(e) => setYamlDraft(e.target.value)}
              className="w-full min-h-[calc(100vh-80px)] p-6 bg-transparent text-sm font-mono text-text-primary leading-relaxed focus:outline-none resize-none"
              spellCheck={false}
              autoFocus
            />
          ) : (
            <pre className="text-sm font-mono text-text-secondary leading-relaxed whitespace-pre">
              {resolvedYaml ?? wf.yaml_content}
            </pre>
          )}
        </FullscreenOverlay>

        {/* Activity Manifest — runtime wiring and discovery reference per step */}
        {wf.activity_manifest?.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">Activity Manifest</h4>
            <div className="space-y-3">
              {(wf.activity_manifest as any[])
                .filter((a: any) => a.tool_source !== 'trigger')
                .map((a: any) => {
                  const hasArgs = a.tool_arguments && Object.keys(a.tool_arguments).length > 0;
                  const hasMappings = a.input_mappings && Object.keys(a.input_mappings).length > 0;
                  if (!hasArgs && !hasMappings) return null;
                  return (
                    <div key={a.activity_id} className="bg-surface-sunken rounded-md p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-mono text-text-tertiary">{a.activity_id}</span>
                        <span className="text-xs font-medium text-text-primary">{a.title}</span>
                        {a.mcp_tool_name && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-raised text-text-secondary">{a.mcp_tool_name}</span>
                        )}
                      </div>
                      {hasMappings && (
                        <div className={hasArgs ? 'mb-3' : ''}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Runtime Wiring</p>
                          <div className="grid gap-1">
                            {Object.entries(a.input_mappings).map(([k, v]) => (
                              <div key={k} className="flex items-baseline gap-2 text-xs">
                                <span className="font-mono text-text-secondary shrink-0">{k}</span>
                                <span className="text-text-tertiary shrink-0">&larr;</span>
                                <span className="font-mono text-accent/70">{v as string}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {hasArgs && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Discovery Reference</p>
                          <p className="text-[10px] text-text-tertiary mb-1.5">Values from the original execution, stored for context. Runtime values are determined by the wiring above.</p>
                          <div className="grid gap-1 opacity-60">
                            {Object.entries(a.tool_arguments).map(([k, v]) => {
                              const val = typeof v === 'string' ? v : JSON.stringify(v);
                              const isLong = val.length > 120;
                              return (
                                <div key={k} className="flex items-baseline gap-2 text-xs">
                                  <span className="font-mono text-text-secondary shrink-0">{k}:</span>
                                  {isLong ? (
                                    <pre className="font-mono text-text-tertiary whitespace-pre-wrap break-all flex-1">{val}</pre>
                                  ) : (
                                    <span className="font-mono text-text-tertiary truncate">{val}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
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
