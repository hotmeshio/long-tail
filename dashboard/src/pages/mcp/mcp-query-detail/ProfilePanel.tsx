import { useState, useEffect, useRef } from 'react';
import { Layers, AlertCircle, X, Pencil, Check } from 'lucide-react';
import { SecondaryAction } from '../../../components/common/display/SecondaryAction';
import { useQueryClient } from '@tanstack/react-query';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { TagInput } from '../../../components/common/form/TagInput';
import { useUpdateYamlWorkflow } from '../../../api/yaml-workflows';
import { PanelTitle } from './PanelTitle';
import { SectionHeading } from './SectionHeading';

// ── Sub-components ───────────────────────────────────────────────────────────

interface ExistingProfileViewProps {
  compiledYaml: any;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Read-only view of an already-compiled workflow profile (step 3, existing path)
 * with inline editing for description and tags.
 */
function ExistingProfileView({ compiledYaml, onBack, onNext }: ExistingProfileViewProps) {
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

// ── Create-new form ──────────────────────────────────────────────────────────

interface CreateProfileFormProps {
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

function CreateProfileForm({
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
            <input type="text" value={compileAppId} onChange={(e) => setCompileAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" placeholder="e.g. longtail" />
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
            <input type="text" value={compileName} onChange={(e) => setCompileName(e.target.value)}
              className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" placeholder="e.g. auth-screenshot-all-nav-pages" />
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

// ── Composite panel ──────────────────────────────────────────────────────────

interface ProfilePanelProps {
  compiledYaml: any | undefined;
  /* Create-form props (only used when compiledYaml is absent) */
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
  isUncompilable?: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function ProfilePanel(props: ProfilePanelProps) {
  const { compiledYaml, isUncompilable, onBack, onNext } = props;

  if (isUncompilable && !compiledYaml) {
    return (
      <div>
        <PanelTitle title="Compile" subtitle="Define the deterministic workflow tool from this execution" icon={Layers} iconClass="text-status-success" />
        <div className="rounded-md bg-status-warning/5 border border-status-warning/20 px-4 py-3 mb-6">
          <p className="text-xs text-status-warning font-medium">Cannot compile this query</p>
          <p className="text-xs text-text-secondary mt-1">
            This query did not complete successfully. Resolve the escalation before compiling to a deterministic workflow.
          </p>
        </div>
        <WizardNav>
          <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
          <span />
        </WizardNav>
      </div>
    );
  }

  if (compiledYaml) {
    return <ExistingProfileView compiledYaml={compiledYaml} onBack={onBack} onNext={onNext} />;
  }

  return (
    <CreateProfileForm
      originalPrompt={props.originalPrompt}
      compileAppId={props.compileAppId}
      setCompileAppId={props.setCompileAppId}
      compileName={props.compileName}
      setCompileName={props.setCompileName}
      compileDescription={props.compileDescription}
      setCompileDescription={props.setCompileDescription}
      compileTags={props.compileTags}
      setCompileTags={props.setCompileTags}
      describeData={props.describeData}
      describePrompt={props.describePrompt}
      allAppIds={props.allAppIds}
      onCompile={props.onCompile}
      isCompiling={props.isCompiling}
      compileError={props.compileError}
      onBack={onBack}
    />
  );
}
