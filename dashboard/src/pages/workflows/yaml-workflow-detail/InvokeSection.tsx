import { useState } from 'react';
import { Play } from 'lucide-react';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { InvokeResultView } from './InvokeResultView';
import { inferFieldType } from './helpers';
import type { InputFieldMeta } from '../../../api/types';

export function InvokeSection({
  wf,
  inputSchema,
  invokeFields,
  setInvokeFields,
  invokeJson,
  setInvokeJson,
  invokeJsonMode,
  setInvokeJsonMode,
  invokeResult,
  setInvokeResult,
  showMetadata,
  setShowMetadata,
  invokeMutation,
  inputFieldMeta,
  settings,
  onInvoke,
  isCollapsed,
  onToggle,
}: {
  wf: any;
  inputSchema: any;
  invokeFields: Record<string, any>;
  setInvokeFields: (v: Record<string, any>) => void;
  invokeJson: string;
  setInvokeJson: (v: string) => void;
  invokeJsonMode: boolean;
  setInvokeJsonMode: (v: boolean) => void;
  invokeResult: Record<string, unknown> | null;
  setInvokeResult: (v: Record<string, unknown> | null) => void;
  showMetadata: boolean;
  setShowMetadata: (v: boolean) => void;
  invokeMutation: any;
  settings: any;
  inputFieldMeta?: InputFieldMeta[];
  onInvoke: () => void;
  isCollapsed: boolean;
  onToggle: (key: string) => void;
}) {
  const inputProps = (inputSchema as any)?.properties || {};
  const allKeys = Object.keys(inputProps);
  const hasFieldMeta = inputFieldMeta && inputFieldMeta.length > 0;

  // When field meta is available, show only dynamic fields by default
  const [showFixedFields, setShowFixedFields] = useState(false);
  const dynamicKeys = hasFieldMeta
    ? inputFieldMeta.filter(f => f.classification === 'dynamic').map(f => f.key)
    : allKeys;
  const fixedKeys = hasFieldMeta
    ? inputFieldMeta.filter(f => f.classification === 'fixed').map(f => f.key)
    : [];
  const inputKeys = showFixedFields ? [...dynamicKeys, ...fixedKeys] : dynamicKeys;

  const updateField = (key: string, value: any, type: string) => {
    let parsed = value;
    if (type === 'number' || type === 'integer') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...invokeFields, [key]: parsed };
    setInvokeFields(updated);
    setInvokeJson(JSON.stringify(updated, null, 2));
  };

  return (
    <CollapsibleSection sectionKey="invoke" title="Invoke / Try" isCollapsed={isCollapsed} onToggle={onToggle} >
      <div className="space-y-4">
        {/* Input form */}
        {!invokeResult && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onInvoke(); }}>
            <div className="flex items-center justify-between">
              <SectionLabel>Input</SectionLabel>
              <div className="flex items-center gap-3">
                {hasFieldMeta && fixedKeys.length > 0 && !invokeJsonMode && (
                  <button type="button" onClick={() => setShowFixedFields(!showFixedFields)}
                    className="text-[10px] text-text-tertiary hover:text-text-primary">
                    {showFixedFields ? `Hide ${fixedKeys.length} fixed` : `Show ${fixedKeys.length} fixed`}
                  </button>
                )}
                <button type="button" onClick={() => {
                  if (!invokeJsonMode) setInvokeJson(JSON.stringify(invokeFields, null, 2));
                  else { try { setInvokeFields(JSON.parse(invokeJson)); } catch { /* keep */ } }
                  setInvokeJsonMode(!invokeJsonMode);
                }} className="text-[10px] text-accent hover:underline">
                  {invokeJsonMode ? 'Form view' : 'JSON view'}
                </button>
              </div>
            </div>

            {invokeJsonMode ? (
              <textarea value={invokeJson} onChange={(e) => setInvokeJson(e.target.value)}
                className="input font-mono text-[11px] w-full leading-relaxed"
                rows={8} spellCheck={false} />
            ) : inputKeys.length > 0 ? (
              <div className="space-y-3">
                {inputKeys.map((key) => {
                  const prop = inputProps[key] as any;
                  const fieldType = inferFieldType(prop);
                  const desc = prop?.description as string | undefined;
                  const jsonValue = typeof invokeFields[key] === 'string'
                    ? invokeFields[key]
                    : JSON.stringify(invokeFields[key] ?? (fieldType === 'array' ? [] : {}), null, 2);
                  const textareaRows = Math.min(20, Math.max(4, (jsonValue?.split?.('\n')?.length ?? 4)));
                  return (
                    <div key={key}>
                      <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                        {key}<span className="ml-2 font-normal normal-case">{fieldType}</span>
                        {hasFieldMeta && fixedKeys.includes(key) && (
                          <span className="ml-2 px-1 py-0.5 text-[8px] bg-surface-sunken rounded">fixed</span>
                        )}
                      </label>
                      {desc && (
                        <p className="text-[10px] text-text-tertiary mb-1">{desc}</p>
                      )}
                      {fieldType === 'boolean' ? (
                        <select value={String(invokeFields[key] ?? false)} onChange={(e) => updateField(key, e.target.value, fieldType)}
                          className="select text-xs w-full">
                          <option value="true">true</option><option value="false">false</option>
                        </select>
                      ) : fieldType === 'object' || fieldType === 'array' ? (
                        <textarea
                          value={jsonValue}
                          onChange={(e) => { try { updateField(key, JSON.parse(e.target.value), fieldType); } catch { setInvokeFields({ ...invokeFields, [key]: e.target.value }); } }}
                          className="input font-mono text-[11px] w-full leading-relaxed"
                          rows={textareaRows} spellCheck={false} />
                      ) : (
                        <input type={fieldType === 'number' || fieldType === 'integer' ? 'number' : 'text'}
                          value={invokeFields[key] ?? ''} onChange={(e) => updateField(key, e.target.value, fieldType)}
                          className="input text-xs w-full" />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">No input schema defined. Switch to JSON view to provide custom input.</p>
            )}

            {invokeMutation.error && !invokeResult && (
              <p className="text-xs text-status-error">{invokeMutation.error.message}</p>
            )}

            <button type="submit" disabled={invokeMutation.isPending} className="btn-primary text-xs">
              {invokeMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-text-inverse border-t-transparent rounded-full animate-spin" />
                  Running...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Play className="w-3 h-3" fill="currentColor" />
                  Invoke
                </span>
              )}
            </button>
          </form>
        )}

        {/* Result */}
        {invokeResult && (
          <div className="space-y-4">
            <InvokeResultView
              result={invokeResult}
              showMetadata={showMetadata}
              onToggleMetadata={() => setShowMetadata(!showMetadata)}
              traceUrl={settings?.telemetry?.traceUrl}
              namespace={wf.app_id}
            />
            <button
              onClick={() => { setInvokeResult(null); invokeMutation.reset(); }}
              className="text-xs text-accent hover:underline"
            >
              Run again
            </button>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
