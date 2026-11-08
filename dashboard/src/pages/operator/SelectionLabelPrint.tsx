import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';

import { useLabelTemplates } from '../../api/labels';
import { useScanSchemes, SCAN_SCHEME_KINDS } from '../../api/scan-codes';
import { PrintLabelsPanel } from '../../components/labels/PrintLabelsPanel';
import type { LTEscalationRecord } from '../../api/types';

/**
 * Print labels for the selected rows: offered when a label template's scheme
 * targets a facet the rows carry.
 * The server re-reads the rows as the caller; the selection only names them.
 */
export function SelectionLabelPrint({ selected }: { selected: LTEscalationRecord[] }) {
  const { data: schemes } = useScanSchemes();
  const { data } = useLabelTemplates();
  const [open, setOpen] = useState(false);

  const templates = useMemo(() => {
    const facets = new Set(selected.flatMap((row) => Object.keys(row.metadata ?? {})));
    const versions = new Set((schemes?.schemes ?? [])
      .filter((s) => s.enabled && s.kind !== SCAN_SCHEME_KINDS.IDENTITY && facets.has(s.target_facet))
      .map((s) => s.version));
    return (data?.templates ?? []).filter((t) => t.enabled && versions.has(t.scheme_version));
  }, [selected, schemes, data]);

  if (selected.length === 0 || templates.length === 0) return null;
  return (
    <>
      <div className="flex justify-end py-1.5">
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover">
          <Tag className="w-3.5 h-3.5" /> Print labels for {selected.length} selected
        </button>
      </div>
      {open && (
        <PrintLabelsPanel
          open={open}
          onClose={() => setOpen(false)}
          title="Print labels"
          templates={templates}
          source={{ kind: 'escalations', ids: selected.map((row) => row.id) }}
          sourceCount={selected.length}
        />
      )}
    </>
  );
}
