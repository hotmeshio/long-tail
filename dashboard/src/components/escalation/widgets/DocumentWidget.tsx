import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, RefreshCw } from 'lucide-react';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { escalationFilesKey } from '../../../api/escalations';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import { useDocumentPane } from '../resolver-form/document-pane';
import {
  DOCUMENT_KINDS,
  isLinkExpired,
  isSourceError,
  resolveDocumentSource,
} from './document/document-source';
import { ImageViewer } from './document/ImageViewer';
import { PdfViewer } from './document/PdfViewer';
import type { WidgetProps } from './index';

/** The viewer's height inside a form; a split pane's lone document fills the pane once it splits. */
export const DOCUMENT_HEIGHT = 'h-[min(75vh,56rem)]';
const PANE_FILL_HEIGHT = 'h-[min(75vh,56rem)] @split:h-[calc(100dvh-14rem)]';

/**
 * Document widget: a stored file shown in place: PDFs as continuous pages,
 * images with zoom and rotation, anything else as an open/download link.
 * Declared as `x-lt-widget: "document"`; `x-lt-source` names the file,
 * usually `file.<as>` from the escalation's signed files. Display-only: the
 * field carries no answer and never reaches the payload.
 *
 * Links are signed for a window. A document already open stays open when its
 * link lapses; one that has not loaded yet asks for a fresh link first.
 */
export function DocumentWidget({ fieldKey, value, schema, escalationContext }: WidgetProps) {
  const queryClient = useQueryClient();
  const label = deriveFieldLabel(fieldKey, schema as Record<string, any> | undefined);
  const helperText = typeof schema?.description === 'string' ? schema.description : undefined;
  const pane = useDocumentPane();
  const heightClass = pane?.fill ? PANE_FILL_HEIGHT : DOCUMENT_HEIGHT;
  const found = resolveDocumentSource(schema?.['x-lt-source'], value, escalationContext as Record<string, unknown> | undefined);
  const escalationId = (escalationContext?.escalation as { id?: string } | null | undefined)?.id;
  const [failed, setFailed] = useState(false);

  const source = found && !isSourceError(found) ? found : null;
  // Judged when a link arrives, not on every render: an open document
  // outlives its link, and only a load waits on a fresh one.
  const [expired, setExpired] = useState(() => !!source && isLinkExpired(source.expiresAt));
  const refresh = () => {
    setFailed(false);
    if (escalationId) void queryClient.invalidateQueries({ queryKey: escalationFilesKey(escalationId) });
  };

  useEffect(() => {
    setFailed(false);
    setExpired(!!source && isLinkExpired(source.expiresAt));
  }, [source?.url]);

  const head = (
    <>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
    </>
  );

  if (!found) {
    return (
      <div data-field-key={fieldKey}>
        {head}
        <p className="text-xs text-text-tertiary italic mt-1">No document attached</p>
      </div>
    );
  }

  if (isSourceError(found) || failed || expired) {
    const message = isSourceError(found)
      ? found.error
      : expired ? 'The link to this document has lapsed' : 'The document could not be loaded';
    return (
      <div data-field-key={fieldKey}>
        {head}
        <div className="mt-1 flex items-center gap-3" role="alert">
          <p className="text-xs text-status-error">{message}</p>
          {escalationId && !isSourceError(found) && (
            <button type="button" onClick={refresh} className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
              <RefreshCw className="w-3 h-3" strokeWidth={1.5} />
              Get a fresh link
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-field-key={fieldKey} data-testid={`document-${fieldKey}`}>
      {head}
      <div className="mt-1.5 border-y border-surface-border">
        {source!.kind === DOCUMENT_KINDS.PDF && (
          <PdfViewer url={source!.url} identity={source!.path ?? source!.url} name={source!.name} heightClass={heightClass} expiresAt={source!.expiresAt} onRefresh={refresh} />
        )}
        {source!.kind === DOCUMENT_KINDS.IMAGE && (
          <ImageViewer url={source!.url} name={source!.name} heightClass={heightClass} expiresAt={source!.expiresAt} onRefresh={refresh} onError={() => setFailed(true)} />
        )}
        {source!.kind === DOCUMENT_KINDS.FILE && (
          <a
            href={source!.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-3 text-xs text-accent hover:text-accent-hover"
          >
            <FileText className="w-4 h-4" strokeWidth={1.5} />
            Open {source!.name}
          </a>
        )}
      </div>
    </div>
  );
}
