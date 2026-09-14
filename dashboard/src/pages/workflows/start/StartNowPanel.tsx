import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import { foldWorkflowLookups, useWorkflowLookups } from '../../../api/workflows';
import type { InvocableWorkflow } from '../../../api/types';
import { WorkflowIcon } from '../../../components/common/display/WorkflowIcon';
import { MarkdownRenderer } from '../../../components/common/display/MarkdownRenderer';
import { identifierToTitle } from '../../../lib/identifier-label';
import { IdentitySummary } from './IdentitySummary';
import { LegacyInvokeForm } from './LegacyInvokeForm';
import { RichInvokeForm } from './RichInvokeForm';
import { useInvokeSubmit } from './use-invoke-submit';

/**
 * The form column. The workflow's name is the column's heading and stays
 * put; Start stays put at the bottom; description, identity, options, and
* the fields scroll between them. A declared input_schema renders the
 * x-lt-* form, with pinned input_lookups resolved into its lookup domain;
 * otherwise the envelope template form.
 */
export function StartNowPanel({ selected }: { selected: InvocableWorkflow }) {
  const { isSuperAdmin, hasRoleType } = useAuth();
  const isAdmin = isSuperAdmin || hasRoleType('admin');
  const [overrideBot, setOverrideBot] = useState('');
  // Per-run interceptor opt-out, offered when the registration is certified.
  const [certified, setCertified] = useState(selected.certified);

  useEffect(() => {
    setOverrideBot('');
    setCertified(selected.certified);
  }, [selected.workflow_type, selected.certified]);

  const metadata = useMemo(() => {
    const md = selected.envelope_schema?.metadata;
    return md && typeof md === 'object' ? (md as Record<string, unknown>) : {};
  }, [selected.envelope_schema]);

  const hasLookups = Array.isArray(selected.input_lookups) && selected.input_lookups.length > 0;
  const { data: lookupData } = useWorkflowLookups(selected.workflow_type, hasLookups);
  const lookup = useMemo(() => (lookupData ? foldWorkflowLookups(lookupData.lookups) : undefined), [lookupData]);
  const missingLookups = lookupData?.lookups.filter((l) => l.missing) ?? [];

  const submission = useInvokeSubmit(selected, { certified, overrideBot });

  const lead = (
    <>
      {selected.description && (
        <MarkdownRenderer content={selected.description} className="text-xs text-text-secondary leading-relaxed" />
      )}
      <IdentitySummary
        config={selected}
        overrideBot={overrideBot}
        onOverrideChange={setOverrideBot}
        showOverride={isAdmin}
      />
      {selected.certified && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={certified}
            onChange={(e) => setCertified(e.target.checked)}
            className="rounded border-surface-border text-accent focus:ring-accent/30"
          />
          <ShieldCheck className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs text-text-secondary">Enable task tracking and escalation routing</span>
        </label>
      )}
    </>
  );

  return (
    <div className="max-w-form" data-testid="invoke-form">
      {/* Sticks to the top of the shell scroll; the pulled-up padding covers the page gutter above it. */}
      <header className="sticky top-0 z-10 bg-surface -mt-8 pt-8 flex items-baseline gap-3 min-w-0 pb-3 mb-5 border-b border-surface-border/60">
        <WorkflowIcon icon={selected.icon} tier={selected.tier} className="w-7 h-7 self-center shrink-0 text-accent" />
        <h2 className="heading-2 truncate" title={selected.workflow_type}>
          {identifierToTitle(selected.workflow_type)}
        </h2>
        <span className="text-2xs font-mono text-text-quaternary shrink-0">{selected.workflow_type}</span>
        <span className="text-2xs uppercase tracking-widest text-text-tertiary shrink-0">{selected.tier}</span>
        {selected.task_queue && (
          <span className="text-2xs font-mono text-text-quaternary truncate">{selected.task_queue}</span>
        )}
      </header>

      {missingLookups.length > 0 && (
        <p className="flex items-center gap-1.5 text-2xs text-status-warning mb-4" data-testid="lookup-missing">
          <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.5} />
          {missingLookups.map((l) => `${l.domain}/${l.key} v${l.version}`).join(', ')} {missingLookups.length === 1 ? 'is' : 'are'} not available; the fields that read {missingLookups.length === 1 ? 'it' : 'them'} fall back to plain inputs.
        </p>
      )}

      {selected.input_schema ? (
        <RichInvokeForm selected={selected} schema={selected.input_schema} metadata={metadata} lookup={lookup} submission={submission} lead={lead} />
      ) : (
        <LegacyInvokeForm selected={selected} metadata={metadata} submission={submission} lead={lead} />
      )}
    </div>
  );
}
