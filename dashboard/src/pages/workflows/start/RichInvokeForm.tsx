import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { buildResolverPayload } from '../../../lib/resolver-payload';
import { buildInvokeFormContext } from '../../../lib/invoke-context';
import { seedFormJson } from '../../../lib/seed-form-json';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { FieldError } from '../../../lib/field-validator';
import type { LTWorkflowConfig } from '../../../api/types';
import { InvokeFooter } from './InvokeFooter';
import { useInvokeSidePanel } from './InvokeSidePanel';
import type { InvokeSubmission } from './use-invoke-submit';

/**
 * The x-lt-* invoke form. The declared input_schema renders through the same
 * ResolverForm the escalation surface uses; live values drive x-lt-showIf
 * under `input` and `resolver`, pinned lookups under `lookup`; submit runs
 * the shared validation pass, maps x-lt-bind into the nested `data`, and
 * posts the envelope the API has always taken. A server 422 lands in the
 * same Issues view.
 */
export function RichInvokeForm({
  selected,
  schema,
  metadata,
  lookup,
  submission,
  lead,
}: {
  selected: LTWorkflowConfig;
  schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  /** Resolved knowledge editions keyed as the form reads them: lookup.<as ?? key>. */
  lookup?: Record<string, unknown>;
  submission: InvokeSubmission;
  /** Content that scrolls with the form ahead of its fields: description, identity, options. */
  lead?: ReactNode;
}) {
  const [json, setJson] = useState(() => seedFormJson(schema));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldError[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setJson(seedFormJson(schema));
    setSubmitAttempted(false);
    setClientErrors([]);
    setParseError(null);
    submission.reset();
  }, [selected.workflow_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const context = useMemo<ShowIfContext>(
    () => ({ ...buildInvokeFormContext(metadata, lookup), resolver: null }),
    [metadata, lookup],
  );
  const liveContext = useMemo<ShowIfContext>(() => {
    try {
      const values = JSON.parse(json) as Record<string, unknown>;
      return { ...context, resolver: values, input: values };
    } catch {
      return context;
    }
  }, [json, context]);

  // Once a submit was tried, the issue list tracks every edit.
  useEffect(() => {
    if (!submitAttempted) return;
    setClientErrors(buildResolverPayload(json, context).errors);
  }, [json, submitAttempted, context]);

  const errors = clientErrors.length > 0 ? clientErrors : submission.violations;
  const panel = useInvokeSidePanel({ schema, context: liveContext, errors });

  useEffect(() => {
    if (submission.violations.length > 0) panel.showIssues();
  }, [submission.violations]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    setSubmitAttempted(true);
    const result = buildResolverPayload(json, context);
    if (result.parseError) {
      setParseError(result.parseError);
      return;
    }
    setParseError(null);
    if (result.errors.length > 0) {
      setClientErrors(result.errors);
      panel.showIssues();
      return;
    }
    setClientErrors([]);
    void submission.submit(result.payload!, metadata);
  };

  return (
    <div data-testid="rich-invoke-form">
      <div className="space-y-6 pb-6">
        {lead}
        <ResolverForm
        value={json}
        onChange={setJson}
        submitAttempted={submitAttempted}
        escalationContext={context}
        onOpenHelp={panel.hasInstructions ? panel.showInstructions : undefined}
      />
      </div>
      <InvokeFooter
        onSubmitAgain={submission.reset}
        onSubmit={handleSubmit}
        pending={submission.pending}
        error={parseError ?? submission.error}
        issueCount={errors.length}
        onShowIssues={panel.showIssues}
        startedId={submission.startedId}
        executionPath={submission.executionPath}
      />
    </div>
  );
}
