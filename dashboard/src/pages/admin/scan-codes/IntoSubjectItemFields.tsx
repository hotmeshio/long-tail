import type { ScanStep } from '../../../api/scan-codes';

function parseList(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Into-subject accumulate: whether the scanned code's own pending row is
 * written with the held row's entry, which queues it sits in, the facets it
 * must carry, and what the station says when it is not waiting.
 */
export function IntoSubjectItemFields({
  step,
  onPatch,
}: {
  step: ScanStep;
  onPatch: (patch: Partial<ScanStep>) => void;
}) {
  const params = step.params ?? {};
  const accumulate = params.accumulate ?? {};
  const item = accumulate.item;
  const setItem = (next: typeof item) => {
    const { item: _old, ...rest } = accumulate;
    onPatch({
      params: { ...params, accumulate: next ? { ...rest, item: next } : rest },
      ...(!next && step.refuse?.missing ? { refuse: { ...step.refuse, missing: undefined } } : {}),
    });
  };

  return (
    <>
      <label className="flex items-center gap-2 basis-full cursor-pointer">
        <input
          type="checkbox"
          checked={!!item}
          onChange={(e) => setItem(e.target.checked ? {} : undefined)}
          className="w-4 h-4 rounded border-border accent-accent"
        />
        <span className="text-xs text-text-secondary">Also record it on the scanned item's own row</span>
      </label>
      {item && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Item queues</span>
          <span className="block text-2xs text-text-tertiary mb-1">Where the item's row waits, comma-separated. Empty: any I can read.</span>
          <input
            value={(item.roles ?? []).join(', ')}
            onChange={(e) => {
              const roles = parseList(e.target.value);
              const { roles: _r, ...rest } = item;
              setItem(roles.length ? { ...rest, roles } : rest);
            }}
            className="input w-[14rem] font-mono"
            placeholder="packing"
            aria-label="Item queues"
          />
        </label>
      )}
      {item && (
        <label className="block">
          <span className="block text-xs text-text-secondary mb-1">Item row has</span>
          <span className="block text-2xs text-text-tertiary mb-1">facet=value pairs, comma-separated.</span>
          <input
            value={Object.entries(item.facets ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}
            onChange={(e) => {
              const facets = Object.fromEntries(parseList(e.target.value)
                .map((pair) => pair.split('=').map((s) => s.trim()))
                .filter(([k, v]) => k && v !== undefined && v !== ''));
              const { facets: _f, ...rest } = item;
              setItem(Object.keys(facets).length ? { ...rest, facets } : rest);
            }}
            className="input w-[14rem] font-mono"
            placeholder="shape=consolidated"
            aria-label="Item row has"
          />
        </label>
      )}
      {item && step.refuse && (
        <label className="block basis-full">
          <span className="block text-xs text-text-secondary mb-1">When the item is not waiting</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            What the station says when the scan is right but the item has no waiting row. Empty: the next step runs.
          </span>
          <input
            value={step.refuse.missing ?? ''}
            onChange={(e) => onPatch({ refuse: { ...step.refuse!, missing: e.target.value || undefined } })}
            className="input w-full"
            placeholder="That one is not waiting to be packed."
            aria-label="When the item is not waiting"
          />
        </label>
      )}
    </>
  );
}
