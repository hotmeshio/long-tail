import { useEffect, useMemo, useState } from 'react';

import { Modal } from '../common/modal/Modal';
import { SelectField } from '../common/form/Field';
import {
  useIssueLabels, useLabelMedia, useLabelTransports, usePreviewLabels,
  type LabelLayout, type LabelOutput, type LabelSource, type LabelTemplate,
} from '../../api/labels';
import { printSheet } from '../../lib/print-sheet';
import { CredentialConfirm } from './CredentialConfirmModal';
import { LabelLayoutFields } from './LabelLayoutFields';
import { LabelSheetPreview } from './LabelSheetPreview';
import { DEFAULT_RANGE, LabelSourceFields, type EditableSource } from './LabelSourceFields';
import { BadgeSourceFields, type UserSource } from './BadgeSourceFields';

interface PrintLabelsPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The templates this entry point offers. */
  templates: LabelTemplate[];
  /** Targets chosen elsewhere (selected rows or users); without it, a range or list, or for badges, everyone or a role. */
  source?: LabelSource;
  /** How many targets `source` names, for the confirmation. */
  sourceCount?: number;
  /** True when the templates print badges (an identity scheme). */
  identity?: boolean;
}

/**
 * The one print flow every entry point opens: choose a template, targets and
 * stock, preview the pages with their warnings, then print in the browser,
 * download a PDF or ZPL, or send to a registered printer. A sensitive
 * template (every badge) confirms first; the server records the requester
 * before it composes a single code.
 */
export function PrintLabelsPanel({ open, onClose, title, templates, source, sourceCount, identity = false }: PrintLabelsPanelProps) {
  const { data: mediaData } = useLabelMedia();
  const { data: transportData } = useLabelTransports();
  const preview = usePreviewLabels();
  const issue = useIssueLabels();

  const [templateName, setTemplateName] = useState(templates[0]?.name ?? '');
  const [typed, setTyped] = useState<EditableSource>(DEFAULT_RANGE);
  const [holders, setHolders] = useState<UserSource>({ kind: 'users' });
  const [layout, setLayout] = useState<LabelLayout>({});
  const [transport, setTransport] = useState('');
  const [pending, setPending] = useState<LabelOutput | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const template = templates.find((t) => t.name === templateName) ?? null;
  const media = mediaData?.media ?? [];
  const chosenMedia = media.find((m) => m.id === layout.media);
  const thermal = chosenMedia?.family === 'thermal';
  const jobSource: LabelSource = source ?? (identity ? holders : typed);
  const sourceReady = !(jobSource.kind === 'users' && jobSource.role === '');

  useEffect(() => {
    if (template && mediaData) setLayout((l) => ({ ...l, media: template.media ?? mediaData.defaultMedia, startPosition: 1 }));
  }, [template?.name, mediaData?.defaultMedia]);

  const request = useMemo(() => ({ template: templateName, source: jobSource, layout }), [templateName, jobSource, layout]);
  const requestKey = JSON.stringify(request);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  // Printing follows a preview of exactly this request, so its warnings are seen first.
  const previewed = !!preview.data && previewedKey === requestKey;
  const count = sourceCount ?? preview.data?.labelCount ?? 0;
  const ready = !!template && previewed && sourceReady && !issue.isPending;

  function run(output: LabelOutput, confirm = false) {
    setDone(null);
    if (template?.sensitive && !confirm) {
      setPending(output);
      return;
    }
    issue.mutate({ ...request, output, confirm: template?.sensitive ? true : undefined }, {
      onSuccess: (result) => {
        setPending(null);
        if (result.sheet) printSheet(result.sheet);
        setDone(result.downloaded
          ? `Saved ${result.downloaded}.`
          : result.receipt ? `Sent to ${output.slice('transport:'.length)} (job ${result.jobId}).` : `Printing job ${result.jobId}.`);
      },
    });
  }

  const sendable = (transportData?.transports ?? []).filter((t) => t.formats.includes(thermal ? 'zpl' : 'pdf'));

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-5xl" closeOnBackdrop={false}>
      <div className="@container space-y-6">
        <div className="grid gap-6 @split:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            <SelectField
              label="Template"
              hint={template?.description ?? 'What each label shows.'}
              value={templateName}
              placeholder={templates.length ? undefined : 'No templates for this choice'}
              options={templates.map((t) => ({ value: t.name, label: t.title }))}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            {source
              ? <p className="text-xs text-text-secondary">{sourceCount ?? 0} selected</p>
              : identity
                ? <BadgeSourceFields value={holders} onChange={setHolders} />
                : <LabelSourceFields value={typed} onChange={setTyped} />}
            <LabelLayoutFields media={media} value={layout} onChange={setLayout} />
            <button
              onClick={() => preview.mutate(request, { onSuccess: () => setPreviewedKey(requestKey) })}
              disabled={!template || !sourceReady || preview.isPending}
              className="btn-secondary text-xs"
            >
              {preview.isPending ? 'Laying out…' : 'Preview'}
            </button>
            {preview.error && <p role="alert" className="text-xs text-status-error">{(preview.error as Error).message}</p>}
          </div>
          <div className="min-w-0">
            {preview.data
              ? <LabelSheetPreview sheet={preview.data.sheet} warnings={preview.data.warnings} />
              : <p className="text-xs text-text-tertiary">Preview the pages before printing.</p>}
          </div>
        </div>

        {pending ? (
          <CredentialConfirm
            count={count}
            identity={identity}
            isPending={issue.isPending}
            error={issue.error as Error | null}
            onConfirm={() => run(pending, true)}
            onClose={() => setPending(null)}
          />
        ) : (
          <div className="flex flex-wrap items-end gap-3 border-t border-surface-border pt-4">
            {!previewed && <p className="text-xs text-text-tertiary">Preview this choice to print it.</p>}
            {!thermal && <button onClick={() => run('sheet')} disabled={!ready} className="btn-primary text-xs">Print</button>}
            {!thermal && <button onClick={() => run('pdf')} disabled={!ready} className="btn-secondary text-xs">Download PDF</button>}
            {thermal && <button onClick={() => run('zpl')} disabled={!ready} className="btn-primary text-xs">Download ZPL</button>}
            {sendable.length > 0 && (
              <>
                <SelectField
                  label="Printer"
                  value={transport}
                  placeholder="Choose…"
                  options={sendable.map((t) => ({ value: t.name, label: t.name }))}
                  onChange={(e) => setTransport(e.target.value)}
                />
                <button onClick={() => run(`transport:${transport}`)} disabled={!ready || !transport} className="btn-secondary text-xs">
                  Send
                </button>
              </>
            )}
            {issue.error && <p role="alert" className="text-xs text-status-error">{(issue.error as Error).message}</p>}
            {done && <p role="status" className="text-xs text-status-success ml-auto">{done}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
