import { Layers } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { PanelTitle } from './PanelTitle';
import { ExistingProfileView } from './ExistingProfileView';
import { CreateProfileForm } from './CreateProfileForm';

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
