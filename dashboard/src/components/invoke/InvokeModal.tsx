import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../common/modal/Modal';
import { WorkflowIcon } from '../common/display/WorkflowIcon';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { foldWorkflowLookups, useWorkflowLookups } from '../../api/workflows';
import type { InvocableWorkflow } from '../../api/types';
import { identifierToTitle } from '../../lib/identifier-label';
import type { InvokePayload } from '../../lib/x-lt-invoke';
import { RichInvokeForm } from '../../pages/workflows/start/RichInvokeForm';
import { LegacyInvokeForm } from '../../pages/workflows/start/LegacyInvokeForm';
import { INVOKE_HOSTS, useInvokeSubmit } from '../../pages/workflows/start/use-invoke-submit';
import { RunReceipt } from './RunReceipt';

/** The run metadata: the workflow's declared metadata with the caller's mapping over it. */
export function invokeRunMetadata(workflow: InvocableWorkflow, mapped: Record<string, unknown>): Record<string, unknown> {
  const declared = workflow.envelope_schema?.metadata;
  return { ...(declared && typeof declared === 'object' ? (declared as Record<string, unknown>) : {}), ...mapped };
}

function InvokeModalBody({ workflow, prefill, onClose }: { workflow: InvocableWorkflow; prefill: InvokePayload; onClose: () => void }) {
  const metadata = useMemo(() => invokeRunMetadata(workflow, prefill.metadata), [workflow, prefill.metadata]);
  const hasLookups = Array.isArray(workflow.input_lookups) && workflow.input_lookups.length > 0;
  const { data: lookupData } = useWorkflowLookups(workflow.workflow_type, hasLookups);
  const lookup = useMemo(() => (lookupData ? foldWorkflowLookups(lookupData.lookups) : undefined), [lookupData]);
  const missingLookups = lookupData?.lookups.filter((l) => l.missing) ?? [];
  const submission = useInvokeSubmit(workflow, { certified: workflow.certified, overrideBot: '' });

  const lead = workflow.description ? (
    <MarkdownRenderer content={workflow.description} className="text-xs text-text-secondary leading-relaxed" />
  ) : undefined;

  // The form stays mounted but hidden behind the receipt, so Try again returns to what was typed.
  const started = submission.startedId !== null;

  return (
    <div data-testid="invoke-modal">
      {started && (
        <RunReceipt workflow={workflow} workflowId={submission.startedId!} onDone={onClose} onRetry={submission.reset} />
      )}
      <div hidden={started}>
      {missingLookups.length > 0 && (
        <p className="flex items-center gap-1.5 text-2xs text-status-warning mb-4" data-testid="lookup-missing">
          <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.5} />
          {missingLookups.map((l) => `${l.domain}/${l.key} v${l.version}`).join(', ')} {missingLookups.length === 1 ? 'is' : 'are'} not available; the fields that read {missingLookups.length === 1 ? 'it' : 'them'} fall back to plain inputs.
        </p>
      )}
      {workflow.input_schema ? (
        <RichInvokeForm
          selected={workflow}
          schema={workflow.input_schema}
          metadata={metadata}
          lookup={lookup}
          submission={submission}
          lead={lead}
          prefill={prefill.data}
          host={INVOKE_HOSTS.MODAL}
        />
      ) : (
        <LegacyInvokeForm
          selected={workflow}
          metadata={metadata}
          submission={submission}
          lead={lead}
          prefill={prefill.data}
          host={INVOKE_HOSTS.MODAL}
        />
      )}
      </div>
    </div>
  );
}

/**
 * A workflow's invoke form in a dialog, opened from another surface with the
 * values that surface already knows. Submitting turns the dialog into a
 * receipt with one action. The body mounts only while open, so each opening
 * starts clean and pinned lookups load on demand. The backdrop does not
 * dismiss a form holding typed input; Escape and the close button do.
 */
export function InvokeModal({
  open,
  onClose,
  workflow,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  workflow: InvocableWorkflow;
  prefill: InvokePayload;
}) {
  const title = (
    <span className="flex items-center gap-2 min-w-0">
      <WorkflowIcon icon={workflow.icon} tier={workflow.tier} className="w-4 h-4 shrink-0 text-accent" />
      <span className="truncate" title={workflow.workflow_type}>{identifierToTitle(workflow.workflow_type)}</span>
    </span>
  );
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-2xl" closeOnBackdrop={false}>
      <InvokeModalBody workflow={workflow} prefill={prefill} onClose={onClose} />
    </Modal>
  );
}
