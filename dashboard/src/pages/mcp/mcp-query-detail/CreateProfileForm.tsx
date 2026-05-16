import { useState, useEffect, useRef } from 'react';
import { Layers, AlertCircle, X } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { TagInput } from '../../../components/common/form/TagInput';
import { sanitizeToolName, sanitizeServerName } from '../../../lib/sanitize';
import { PanelTitle } from './PanelTitle';
import { SectionHeading } from './SectionHeading';

export interface CreateProfileFormProps {
  originalPrompt: string | undefined;
  compileAppId: string;
  setCompileAppId: (v: string) => void;
  compileName: string;
  setCompileName: (v: string) => void;
  compileDescription: string;
  setCompileDescription: (v: string) => void;
  compileTags: string[];
  setCompileTags: (v: string[]) => void;
  describeData: { tool_name?: string; description: string; tags: string[] } | undefined;
  describePrompt: string | undefined;
  allAppIds: string[];
  onCompile: () => Promise<void>;
  isCompiling: boolean;
  compileError: string | undefined;
  onBack: () => void;
}

export function CreateProfileForm({
  originalPrompt,
  compileAppId,
  setCompileAppId,
  compileName,
  setCompileName,
  compileDescription,
  setCompileDescription,
  compileTags,
  setCompileTags,
  describeData,
  describePrompt,
  allAppIds,
  onCompile,
  isCompiling,
  compileError,
  onBack,
}: CreateProfileFormProps) {
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const visibleError = compileError && compileError !== dismissedError ? compileError : null;

  // Scroll error into view and reset dismissed state when a new error appears
  useEffect(() => {
    if (visibleError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [visibleError]);
  useEffect(() => {
    if (compileError && compileError !== dismissedError) {
      setDismissedError(null);
      setDismissing(false);
    }
  }, [compileError]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = () => {
    setDismissing(true);
    setTimeout(() => {
      setDismissedError(compileError!);
      setDismissing(false);
    }, 250);
  };

  return (
    <div>
      <PanelTitle title="Compile" subtitle="Define the deterministic workflow tool from this execution" icon={Layers} iconClass="text-status-success" />

      {visibleError && (
        <div
          ref={errorRef}
          className="mb-6 rounded-lg border border-status-error/30 bg-status-error/[0.04] px-4 py-3 flex items-start gap-3 overflow-hidden transition-all duration-250 ease-in-out"
          style={{
            animation: dismissing ? undefined : 'fadeIn 300ms ease-out both',
            opacity: dismissing ? 0 : 1,
            maxHeight: dismissing ? '0px' : '200px',
            paddingTop: dismissing ? '0px' : undefined,
            paddingBottom: dismissing ? '0px' : undefined,
            marginBottom: dismissing ? '0px' : undefined,
          }}
        >
          <AlertCircle className="w-4 h-4 text-status-error shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-status-error">Compilation failed</p>
            <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{visibleError}</p>
          </div>
          <button onClick={handleDismiss} className="text-text-tertiary hover:text-text-secondary transition-colors shrink-0 mt-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {originalPrompt && (
        <div className="mb-6">
          <SectionHeading>Original Query</SectionHeading>
          <p className="text-xs font-mono text-text-primary leading-relaxed bg-surface-sunken rounded-md px-3 py-2">{originalPrompt}</p>
        </div>
      )}

      <SectionHeading>Workflow Configuration</SectionHeading>
      <div className="flex gap-6">
        {/* Col 1: identity fields (~30%) */}
        <div className="w-[30%] shrink-0 space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Namespace *</label>
            <input type="text" value={compileAppId} onChange={(e) => setCompileAppId(sanitizeServerName(e.target.value))}
              className="input" placeholder="e.g. longtail" />
            {allAppIds.length > 0 && (
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                {allAppIds.map((id) => (
                  <button key={id} type="button" onClick={() => setCompileAppId(id)}
                    className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${compileAppId === id ? 'bg-accent/20 text-accent' : 'bg-surface-sunken text-text-tertiary hover:text-text-secondary'}`}>{id}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tool Name *</label>
            <input type="text" value={compileName} onChange={(e) => setCompileName(sanitizeToolName(e.target.value))}
              className="input" placeholder="e.g. auth_screenshot_all_nav_pages" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</label>
            <TagInput tags={compileTags} onChange={setCompileTags} placeholder="e.g. browser, screenshots, login" />
            <p className="text-[10px] text-text-tertiary mt-1">Press Enter or comma to add.</p>
          </div>
        </div>

        {/* Col 2: description (~80%) */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
            {!compileDescription && !describeData && describePrompt && <span className="text-[10px] text-accent animate-pulse">Generating...</span>}
          </div>
          <textarea value={compileDescription} onChange={(e) => setCompileDescription(e.target.value)}
            placeholder="Describe what this workflow does as a reusable tool..."
            className="flex-1 min-h-[120px] w-full px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
          <p className="text-[10px] text-text-tertiary mt-1">{describeData ? 'AI-generated. Edit to refine.' : 'Describe what this workflow does so future queries can find it.'}</p>
        </div>
      </div>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <button onClick={onCompile} disabled={!compileName.trim() || !compileAppId.trim() || isCompiling} className="btn-primary text-xs">
          {isCompiling ? 'Compiling...' : 'Compile Pipeline'}
        </button>
      </WizardNav>
    </div>
  );
}
