import { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useInvocableWorkflows } from '../../../api/workflows';
import type { InvocableWorkflow } from '../../../api/types';
import { ESCALATION_STATUS } from '../../../lib/constants';
import { identifierToTitle } from '../../../lib/identifier-label';
import { buildInvokeFormContext } from '../../../lib/invoke-context';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { INVOKE_VARIANTS, readInvokeConfig, resolveInvokePayload, type InvokeConfig, type InvokePayload } from '../../../lib/x-lt-invoke';
import { validateResolverPayload, type FieldError } from '../../../lib/field-validator';
import { Modal } from '../../common/modal/Modal';
import { WorkflowIcon } from '../../common/display/WorkflowIcon';
import { InvokeModal, invokeRunMetadata } from '../../invoke/InvokeModal';
import { EventsOffNotice } from '../../../pages/workflows/start/InvokeFooter';
import { RunOutcomeLabel, RunOutline, RUN_OUTCOMES, useRunOutcome } from '../../../pages/workflows/start/StartedRunNotice';
import { useInvokeSubmit } from '../../../pages/workflows/start/use-invoke-submit';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import type { WidgetProps } from './index';

const CONTROL_CLASS: Record<InvokeConfig['variant'], string> = {
  [INVOKE_VARIANTS.LINK]: 'inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors',
  [INVOKE_VARIANTS.BUTTON]: 'btn-secondary inline-flex items-center gap-1.5 text-xs px-3 py-1.5',
};

/**
 * Invoke widget: starts a workflow from inside the form. The declaration in
 * `x-lt-invoke` names the workflow and maps the escalation context into its
 * payload. The control appears only for workflows the caller may invoke, as
 * the Invoke Tool page lists them, and only while the escalation is pending.
 *
 * Direct mode posts the mapped payload and follows the run here: the control
 * gives way to the outcome, the returned data reads as an outline, and the
 * control returns beneath it once the run has settled. A payload the target's
 * input schema refuses, on either side of the wire, lists its issues beneath
 * the control with a way to finish in the workflow's own form. Modal mode
 * opens that form at once, prefilled from the same mapping.
 *
 * Display-only: the field carries no answer and is dropped from the payload.
 */
export function InvokeWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const config = useMemo(() => readInvokeConfig(schema), [schema]);
  const { data: workflows, isPending } = useInvocableWorkflows();
  const workflow = workflows?.find((w) => w.workflow_type === config?.workflow);
  const status = (escalationContext?.escalation as { status?: string } | null | undefined)?.status;
  const terminal = status !== undefined && status !== ESCALATION_STATUS.PENDING;

  if (!config || terminal) return null;
  if (isPending) {
    return <div className="h-4 w-32 rounded bg-surface-hover animate-pulse" data-testid={`invoke-widget-${fieldKey}-loading`} />;
  }
  if (!workflow) return null;
  return <InvokeControl fieldKey={fieldKey} schema={schema} config={config} workflow={workflow} escalationContext={escalationContext} />;
}

function InvokeControl({
  fieldKey,
  schema,
  config,
  workflow,
  escalationContext,
}: {
  fieldKey: string;
  schema: WidgetProps['schema'];
  config: InvokeConfig;
  workflow: InvocableWorkflow;
  escalationContext: WidgetProps['escalationContext'];
}) {
  const ctx = escalationContext as Record<string, unknown> | undefined;
  const payload = useMemo<InvokePayload>(() => resolveInvokePayload(config, ctx), [config, ctx]);
  const metadata = useMemo(() => invokeRunMetadata(workflow, payload.metadata), [workflow, payload.metadata]);
  const submission = useInvokeSubmit(workflow, { certified: workflow.certified, overrideBot: '' });
  const run = useRunOutcome(submission.startedId ?? '');
  const [issues, setIssues] = useState<FieldError[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const label = (schema?.title as string | undefined) ?? identifierToTitle(workflow.workflow_type);
  const helperText = schema?.description as string | undefined;
  const Icon = config.icon ? <WorkflowIcon icon={workflow.icon} tier={workflow.tier} className="w-3.5 h-3.5 shrink-0" /> : null;

  const fire = () => {
    setConfirming(false);
    void submission.submit(payload.data, metadata);
  };

  const activate = () => {
    if (config.modal) {
      setModalOpen(true);
      return;
    }
    setIssues([]);
    if (workflow.input_schema) {
      const violations = validateResolverPayload(workflow.input_schema, payload.data, buildInvokeFormContext(metadata));
      if (violations.length > 0) {
        setIssues(violations);
        return;
      }
    }
    if (config.confirm) setConfirming(true);
    else fire();
  };

  const openForm = () => {
    setIssues([]);
    submission.reset();
    setModalOpen(true);
  };

  const shownIssues = issues.length > 0 ? issues : submission.violations;
  const started = submission.startedId !== null;
  const running = started && run.outcome === RUN_OUTCOMES.RUNNING;
  const failure = started && run.outcome === RUN_OUTCOMES.FAILED && typeof run.payload?.error === 'string' ? run.payload.error : null;

  return (
    <div data-field-key={fieldKey} data-testid={`invoke-widget-${fieldKey}`}>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      <div className="mt-1 flex flex-col gap-1.5">
        {started && (
          <>
            <RunOutcomeLabel outcome={run.outcome} />
            {running && <EventsOffNotice />}
            {failure && <p className="text-2xs text-status-error" role="alert">{failure}</p>}
            {!running && <RunOutline payload={failure ? undefined : run.payload} />}
          </>
        )}
        {!running && (
          <button
            type="button"
            onClick={activate}
            disabled={submission.pending}
            className={`self-start ${CONTROL_CLASS[config.variant]}`}
            data-testid={`invoke-control-${fieldKey}`}
          >
            {Icon}
            {submission.pending ? 'Starting…' : label}
          </button>
        )}

        {shownIssues.length > 0 && (
          <div className="text-2xs" role="alert" data-testid={`invoke-issues-${fieldKey}`}>
            <ul className="space-y-0.5 text-status-error">
              {shownIssues.map((v) => (
                <li key={v.field} className="flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 mt-px shrink-0" strokeWidth={1.5} />
                  <span><span className="font-semibold">{v.field}</span> · {v.message}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={openForm} className="mt-1 text-accent hover:underline" data-testid={`invoke-open-form-${fieldKey}`}>
              Open form
            </button>
          </div>
        )}
        {shownIssues.length === 0 && submission.error && (
          <p className="text-2xs text-status-error" role="alert">{submission.error}</p>
        )}
      </div>

      {config.confirm && (
        <Modal open={confirming} onClose={() => setConfirming(false)} title={label}>
          <p className="text-sm text-text-secondary mb-5">{interpolateHelp(config.confirm, escalationContext ?? {})}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="btn-secondary text-xs">Cancel</button>
            <button type="button" onClick={fire} className="btn-primary text-xs" data-testid={`invoke-confirm-${fieldKey}`}>{label}</button>
          </div>
        </Modal>
      )}

      <InvokeModal open={modalOpen} onClose={() => setModalOpen(false)} workflow={workflow} prefill={payload} />
    </div>
  );
}
