import { useMemo, useRef, useState } from 'react';

import { renderSheetSvg } from '../../../../shared/labels/render-svg';
import type { LabelSheet, LabelWarning } from '../../../../shared/labels/types';
import { canVerifySymbols, verifySymbols, type SymbolCheck } from '../../lib/verify-symbols';

const WARNINGS_SHOWN = 8;

/**
 * Pages as they will print, label outlines dashed, with every warning that
 * would make a code fail on the floor listed under them. Markup comes from
 * the shared renderer, which escapes all label text.
 */
export function LabelSheetPreview({ sheet, warnings }: { sheet: LabelSheet; warnings: LabelWarning[] }) {
  const pages = useMemo(() => renderSheetSvg(sheet, { outlines: true }), [sheet]);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<SymbolCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const labelCount = sheet.pages.reduce((n, p) => n + p.labels.length, 0);

  async function runCheck() {
    if (!pagesRef.current) return;
    setChecking(true);
    try {
      setCheck(await verifySymbols(pagesRef.current));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span>{labelCount} labels on {pages.length} {pages.length === 1 ? 'page' : 'pages'} · {sheet.media.name}</span>
        {canVerifySymbols() && (
          <button onClick={runCheck} disabled={checking} className="ml-auto text-accent hover:text-accent-hover">
            {checking ? 'Checking…' : 'Check codes on screen'}
          </button>
        )}
      </div>
      {check && (
        <p role="status" className={`text-xs ${check.missing.length ? 'text-status-error' : 'text-status-success'}`}>
          {check.decoded} of {check.expected} codes read back on screen
          {check.missing.length > 0 && `; not read: ${check.missing.slice(0, 3).join(', ')}`}
        </p>
      )}
      {warnings.length > 0 && (
        <ul aria-label="Label warnings" className="space-y-1 border-l-2 border-l-status-error pl-3">
          {warnings.slice(0, WARNINGS_SHOWN).map((w, i) => (
            <li key={i} className="text-xs text-text-secondary">
              <span className="font-medium text-status-error">Label {w.index + 1}</span> · {w.detail}
            </li>
          ))}
          {warnings.length > WARNINGS_SHOWN && (
            <li className="text-xs text-text-tertiary">and {warnings.length - WARNINGS_SHOWN} more</li>
          )}
        </ul>
      )}
      <div ref={pagesRef} className="grid gap-4 @split:grid-cols-2">
        {pages.map((svg, i) => (
          <div
            key={i}
            data-page={i + 1}
            className="bg-white shadow-sm [&>svg]:w-full [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ))}
      </div>
    </div>
  );
}
