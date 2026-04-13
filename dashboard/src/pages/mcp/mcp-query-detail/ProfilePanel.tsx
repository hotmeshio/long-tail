import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';

import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { TagInput } from '../../../components/common/form/TagInput';
import { PanelTitle } from './PanelTitle';
import { SectionHeading } from './SectionHeading';

// ── Sub-components ───────────────────────────────────────────────────────────

interface ExistingProfileViewProps {
  compiledYaml: any;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Read-only view of an already-compiled workflow profile (step 3, existing path).
 */
function ExistingProfileView({ compiledYaml, onBack, onNext }: ExistingProfileViewProps) {
  return (
    <div>
      <PanelTitle title="Compile" subtitle="Compiled deterministic pipeline — name, tags, input schema, and deployment target" icon={Layers} iconClass="text-status-success" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
        {/* Left: identity + description */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Name</p>
              <p className="text-sm font-mono text-text-primary">{compiledYaml.name}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Status</p>
              <StatusBadge status={compiledYaml.status} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Namespace</p>
              <p className="text-xs font-mono text-text-primary">{compiledYaml.app_id || '\u2014'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Topic</p>
              <p className="text-xs font-mono text-text-primary">{compiledYaml.graph_topic || '\u2014'}</p>
            </div>
          </div>
          {compiledYaml.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Description</p>
              <p className="text-xs text-text-secondary leading-relaxed">{compiledYaml.description}</p>
            </div>
          )}
        </div>

        {/* Right: pipeline + tags */}
        <div className="space-y-4">
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
          {compiledYaml.tags?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</p>
              <div className="flex gap-1.5 flex-wrap">
                {(compiledYaml.tags as string[]).slice(0, 12).map((tag: string) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-sunken text-text-secondary">{tag}</span>
                ))}
                {(compiledYaml.tags as string[]).length > 12 && (
                  <span className="text-[10px] text-text-tertiary">+{(compiledYaml.tags as string[]).length - 12} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <div className="flex gap-3">
          <Link to={`/mcp/workflows/${compiledYaml.id}`} className="px-3 py-1.5 text-xs border border-surface-border rounded text-text-primary hover:bg-surface-sunken transition-colors">
            Edit Workflow
          </Link>
          {compiledYaml.status !== 'active'
            ? <button onClick={onNext} className="btn-primary text-xs">Next: Deploy</button>
            : <button onClick={onNext} className="btn-primary text-xs">Next: Test</button>}
        </div>
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
  compileFeedback: string;
  setCompileFeedback: (v: string) => void;
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
  compileFeedback,
  setCompileFeedback,
  onCompile,
  isCompiling,
  compileError,
  onBack,
}: CreateProfileFormProps) {
  const [showFeedback, setShowFeedback] = useState(!!compileFeedback);
  return (
    <div>
      <PanelTitle title="Compile" subtitle="Define the deterministic workflow tool from this execution" icon={Layers} iconClass="text-status-success" />

      {originalPrompt && (
        <div className="mb-6">
          <SectionHeading>Original Query</SectionHeading>
          <p className="text-xs text-text-primary leading-relaxed">{originalPrompt}</p>
        </div>
      )}

      <SectionHeading>Workflow Configuration</SectionHeading>
      <div className="space-y-5">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Namespace *</label>
          <input type="text" value={compileAppId} onChange={(e) => setCompileAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
            className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" placeholder="e.g. longtail" />
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
            className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" placeholder="e.g. auth-screenshot-all-nav-pages" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
            {!compileDescription && !describeData && describePrompt && <span className="text-[10px] text-accent animate-pulse">Generating...</span>}
          </div>
          <textarea value={compileDescription} onChange={(e) => setCompileDescription(e.target.value)}
            placeholder="Describe what this workflow does as a reusable tool..."
            className="w-full min-h-[80px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
          <p className="text-[10px] text-text-tertiary mt-1">{describeData ? 'AI-generated. Edit to refine.' : 'Describe what this workflow does so future queries can find it.'}</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tags</label>
          <TagInput tags={compileTags} onChange={setCompileTags} placeholder="e.g. browser, screenshots, login" />
          <p className="text-[10px] text-text-tertiary mt-1">Press Enter or comma to add.</p>
        </div>
      </div>

      <div className="mt-5">
        <button type="button" onClick={() => setShowFeedback(!showFeedback)}
          className="text-xs text-accent hover:text-accent/80 transition-colors">
          {showFeedback ? 'Hide refinement feedback' : 'Refine compilation'}
        </button>
        {showFeedback && (
          <div className="mt-2">
            <textarea value={compileFeedback} onChange={(e) => setCompileFeedback(e.target.value)}
              placeholder="Describe what should change. E.g.: 'Only url, username, password, and screenshot_dir should be dynamic inputs. The steps array is an implementation detail.'"
              className="w-full min-h-[80px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
            <p className="text-[10px] text-text-tertiary mt-1">This feedback is sent to the compiler so it can adjust inputs, outputs, and step selection.</p>
          </div>
        )}
      </div>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <button onClick={onCompile} disabled={!compileName.trim() || !compileAppId.trim() || isCompiling} className="btn-primary text-xs">
          {isCompiling ? 'Compiling...' : 'Compile Pipeline'}
        </button>
      </WizardNav>
      {compileError && <p className="mt-3 text-sm text-status-error">{compileError}</p>}
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
  compileFeedback: string;
  setCompileFeedback: (v: string) => void;
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
      compileFeedback={props.compileFeedback}
      setCompileFeedback={props.setCompileFeedback}
      onCompile={props.onCompile}
      isCompiling={props.isCompiling}
      compileError={props.compileError}
      onBack={onBack}
    />
  );
}
