import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import type { InvocableWorkflow } from '../../../api/types';
import { VARIANT_ICON } from '../../../components/common/display/WorkflowPill';
import { MarkdownRenderer } from '../../../components/common/display/MarkdownRenderer';
import { IdentitySummary } from './IdentitySummary';
import { LegacyInvokeForm } from './LegacyInvokeForm';
import { RichInvokeForm } from './RichInvokeForm';
import { useInvokeSubmit } from './use-invoke-submit';

/**
 * The form column. The workflow's name is the column's heading and stays
 * put; Start stays put at the bottom; description, identity, options, and
 * the fields scroll between them. A declared input_schema renders the
 * x-lt-* form; otherwise the envelope template form.
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

  const submission = useInvokeSubmit(selected, { certified, overrideBot });
  const TierIcon = VARIANT_ICON[selected.tier];

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
        <TierIcon className="w-5 h-5 self-center shrink-0 text-accent/65" strokeWidth={1.5} aria-hidden />
        <h2 className="text-2xl font-mono text-text-primary truncate" title={selected.workflow_type}>
          {selected.workflow_type}
        </h2>
        <span className="text-2xs uppercase tracking-widest text-text-tertiary shrink-0">{selected.tier}</span>
        {selected.task_queue && (
          <span className="text-2xs font-mono text-text-quaternary truncate">{selected.task_queue}</span>
        )}
      </header>

      {selected.input_schema ? (
        <RichInvokeForm selected={selected} schema={selected.input_schema} metadata={metadata} submission={submission} lead={lead} />
      ) : (
        <LegacyInvokeForm selected={selected} metadata={metadata} submission={submission} lead={lead} />
      )}
    </div>
  );
}
