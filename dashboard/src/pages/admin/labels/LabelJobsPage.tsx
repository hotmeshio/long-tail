import { useState } from 'react';

import { PageHeader } from '../../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { DateValue } from '../../../components/common/display/DateValue';
import { UserName } from '../../../components/common/display/UserName';
import { CredentialConfirmModal } from '../../../components/labels/CredentialConfirmModal';
import { useLabelJobs, useReprintLabelJob, type LabelJob } from '../../../api/labels';
import { printSheet } from '../../../lib/print-sheet';

const ACTION_LABEL: Record<LabelJob['action'], string> = {
  print: 'Printed',
  reissue: 'Reissued badge',
  bind: 'Bound badge',
};

function what(job: LabelJob): string {
  if (job.subject_user_ids?.length) return `${job.subject_user_ids.length} ${job.subject_user_ids.length === 1 ? 'person' : 'people'}`;
  const targets = job.targets ?? [];
  return targets.length > 3 ? `${targets.slice(0, 3).join(', ')} and ${targets.length - 3} more` : targets.join(', ');
}

/**
 * The label ledger as the reader may see it: who printed which labels,
 * badge reissues and bindings, newest first. A print can be printed again
 * from its source with the template as it is now; badges confirm again.
 */
export function LabelJobsPage() {
  const { data, isLoading } = useLabelJobs();
  const reprint = useReprintLabelJob();
  const [confirming, setConfirming] = useState<LabelJob | null>(null);

  function printAgain(job: LabelJob, confirm = false) {
    if (job.sensitive && !confirm) {
      setConfirming(job);
      return;
    }
    reprint.mutate({ id: job.id, output: 'sheet', confirm: job.sensitive || undefined }, {
      onSuccess: (result) => {
        setConfirming(null);
        if (result.sheet) printSheet(result.sheet);
      },
    });
  }

  const columns: Column<LabelJob>[] = [
    { key: 'created_at', label: 'When', render: (job) => <DateValue date={job.created_at} />, className: 'w-36 whitespace-nowrap' },
    { key: 'action', label: 'Act', render: (job) => <span className="text-xs">{ACTION_LABEL[job.action]}{job.sensitive && job.action === 'print' ? ' · badge' : ''}</span> },
    { key: 'requested_by', label: 'By', render: (job) => (job.requested_by ? <UserName userId={job.requested_by} className="text-xs" /> : <span className="text-xs text-text-quaternary">—</span>) },
    { key: 'template_name', label: 'Template', render: (job) => <span className="text-xs font-mono">{job.template_name ?? '—'}</span> },
    { key: 'targets', label: 'For', render: (job) => <span className="text-xs text-text-secondary truncate">{what(job)}</span> },
    { key: 'label_count', label: 'Labels', render: (job) => <span className="text-xs tabular-nums">{job.label_count}</span>, className: 'w-16 text-right' },
    {
      key: 'id',
      label: '',
      render: (job) => job.action === 'print' && job.template_name ? (
        <button onClick={() => printAgain(job)} disabled={reprint.isPending} className="text-xs text-accent hover:text-accent-hover">Print again</button>
      ) : null,
      className: 'w-24 text-right',
    },
  ];

  return (
    <div>
      <PageHeader title="Label history" />
      {reprint.error && !confirming && <p role="alert" className="text-xs text-status-error mb-3">{(reprint.error as Error).message}</p>}
      <DataTable
        columns={columns}
        data={data?.jobs ?? []}
        keyFn={(job) => job.id}
        isLoading={isLoading}
        emptyMessage="No labels printed yet"
      />
      <CredentialConfirmModal
        open={!!confirming}
        count={confirming?.label_count ?? 0}
        identity={confirming?.scheme_kind === 'identity'}
        isPending={reprint.isPending}
        error={reprint.error as Error | null}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && printAgain(confirming, true)}
      />
    </div>
  );
}
