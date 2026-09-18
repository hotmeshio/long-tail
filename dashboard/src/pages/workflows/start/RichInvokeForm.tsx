import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { ErrorsPanel } from '../../../components/escalation/ErrorsPanel';
import { MarkdownRenderer } from '../../../components/common/display/MarkdownRenderer';
import { buildResolverPayload } from '../../../lib/resolver-payload';
import { buildInvokeFormContext } from '../../../lib/invoke-context';
import { seedFormJson } from '../../../lib/seed-form-json';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { FieldError } from '../../../lib/field-validator';
import type { LTWorkflowConfig } from '../../../api/types';
import { InvokeFooter } from './InvokeFooter';
import { INVOKE_PANEL_VIEWS, useInvokeSidePanel } from './InvokeSidePanel';
import { INVOKE_HOSTS, type InvokeHost, type InvokeSubmission } from './use-invoke-submit';

type InlineView = (typeof INVOKE_PANEL_VIEWS)[keyof typeof INVOKE_PANEL_VIEWS];

/**
 * The x-lt-* invoke form. The declared input_schema renders through the same
 * ResolverForm the escalation surface uses; live values drive x-lt-showIf
 * under `input` and `resolver`, pinned lookups under `lookup`; submit runs
 * the shared validation pass, maps x-lt-bind into the nested `data`, and
 * posts the envelope the API has always taken. A server 422 lands in the
 * same Issues view. On the page, Instructions and Issues use the shell's side
 * slot; in a dialog they render inline beneath the fields.
 */
export function RichInvokeForm({
  selected,
  schema,
  metadata,
  lookup,
  submission,
  lead,
  prefill,
  host = INVOKE_HOSTS.PAGE,
}: {
  selected: LTWorkflowConfig;
  schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  /** Resolved knowledge editions keyed as the form reads them: lookup.<as ?? key>. */
  lookup?: Record<string, unknown>;
  submission: InvokeSubmission;
  /** Content that scrolls with the form ahead of its fields: description, identity, options. */
  lead?: ReactNode;
  /** The nested `data` payload the fields start from, inverted through x-lt-bind. */
  prefill?: Record<string, unknown>;
  host?: InvokeHost;
}) {
  const inline = host === INVOKE_HOSTS.MODAL;
  const [json, setJson] = useState(() => seedFormJson(schema, prefill));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldError[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [inlineView, setInlineView] = useState<InlineView | null>(null);

  useEffect(() => {
    setJson(seedFormJson(schema, prefill));
    setSubmitAttempted(false);
    setClientErrors([]);
    setParseError(null);
    setInlineView(null);
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
  const panel = useInvokeSidePanel({ schema, context: liveContext, errors, enabled: !inline });
  const showIssues = inline ? () => setInlineView(INVOKE_PANEL_VIEWS.ISSUES) : panel.showIssues;
  const showInstructions = inline
    ? () => setInlineView((v) => (v === INVOKE_PANEL_VIEWS.INSTRUCTIONS ? null : INVOKE_PANEL_VIEWS.INSTRUCTIONS))
    : panel.showInstructions;

  useEffect(() => {
    if (submission.violations.length > 0) showIssues();
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
      showIssues();
      return;
    }
    setClientErrors([]);
    void submission.submit(result.payload!, metadata);
  };

  const inlineIssues = inline && inlineView === INVOKE_PANEL_VIEWS.ISSUES && errors.length > 0;
  const inlineHelp = inline && inlineView === INVOKE_PANEL_VIEWS.INSTRUCTIONS && panel.helpMarkdown;

  return (
    <div data-testid="rich-invoke-form">
      <div className="space-y-6 pb-6">
        {lead}
        {inlineHelp && (
          <div className="px-4 py-3 bg-surface-hover" data-testid="invoke-inline-help">
            <MarkdownRenderer content={panel.helpMarkdown!} />
          </div>
        )}
        <ResolverForm
          value={json}
          onChange={setJson}
          submitAttempted={submitAttempted}
          escalationContext={context}
          onOpenHelp={panel.hasInstructions ? showInstructions : undefined}
        />
        {inlineIssues && (
          <div data-testid="invoke-inline-issues">
            <ErrorsPanel errors={errors} schema={schema} />
          </div>
        )}
      </div>
      <InvokeFooter
        onSubmitAgain={submission.reset}
        onSubmit={handleSubmit}
        pending={submission.pending}
        error={parseError ?? submission.error}
        issueCount={errors.length}
        onShowIssues={showIssues}
        startedId={submission.startedId}
        executionPath={submission.executionPath}
        host={host}
      />
    </div>
  );
}
