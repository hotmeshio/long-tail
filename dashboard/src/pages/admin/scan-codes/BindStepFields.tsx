import { useState } from 'react';

type BindParams = { scheme?: number; facet?: string; move?: boolean; resolve?: { payload?: Record<string, unknown> } };

/** Parse a resolve payload; null when the text is not a JSON object. */
export function payloadOf(text: string): Record<string, unknown> | undefined | null {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A bind step's options: the held row's facet the code binds to, the scheme it is kept under, moving, and resolving the held row. */
export function BindStepFields({ bind, onBind }: { bind: BindParams; onBind: (bind: BindParams) => void }) {
  const [payloadText, setPayloadText] = useState(bind.resolve?.payload ? JSON.stringify(bind.resolve.payload, null, 2) : '');
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const without = <K extends keyof BindParams>(key: K) => {
    const { [key]: _drop, ...rest } = bind;
    return rest;
  };
  const onPayloadChange = (text: string) => {
    setPayloadText(text);
    const payload = payloadOf(text);
    if (payload === null) { setPayloadError('Fix the JSON object to save this payload.'); return; }
    setPayloadError(null);
    onBind({ ...bind, resolve: payload ? { payload } : {} });
  };

  return (
    <>
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">Bind to</span>
        <span className="block text-2xs text-text-tertiary mb-1">Name the held row's facet; blank uses its scheme's target facet.</span>
        <input
          value={bind.facet ?? ''}
          onChange={(e) => onBind(e.target.value.trim() ? { ...without('facet'), facet: e.target.value.trim() } : without('facet'))}
          className="input w-[14rem] font-mono"
          placeholder="serialNumber"
          aria-label="Bind to"
        />
      </label>
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">Keep under scheme</span>
        <span className="block text-2xs text-text-tertiary mb-1">Enter a scheme version; blank keeps it under the scanned code's.</span>
        <input
          type="number" min={10} max={99}
          value={bind.scheme ?? ''}
          onChange={(e) => onBind(e.target.value ? { ...without('scheme'), scheme: Number(e.target.value) } : without('scheme'))}
          className="input w-[12rem]"
          aria-label="Keep under scheme"
        />
      </label>
      <label className="flex items-center gap-2 basis-full cursor-pointer">
        <input
          type="checkbox"
          checked={!!bind.move}
          onChange={(e) => onBind(e.target.checked ? { ...bind, move: true } : without('move'))}
          className="w-4 h-4 rounded border-border accent-accent"
          aria-label="Move a value bound elsewhere"
        />
        <span className="text-xs text-text-secondary">Move a value bound elsewhere here, retiring its old binding</span>
      </label>
      <label className="flex items-center gap-2 basis-full cursor-pointer">
        <input
          type="checkbox"
          checked={!!bind.resolve}
          onChange={(e) => onBind(e.target.checked ? { ...bind, resolve: payloadOf(payloadText) ? { payload: payloadOf(payloadText)! } : {} } : without('resolve'))}
          className="w-4 h-4 rounded border-border accent-accent"
          aria-label="Resolve the held row"
        />
        <span className="text-xs text-text-secondary">Then resolve the held row and release it</span>
      </label>
      {bind.resolve && (
        <label className="block basis-full">
          <span className="block text-xs text-text-secondary mb-1">Resolver payload</span>
          <span className="block text-2xs text-text-tertiary mb-1">
            Optional JSON submitted as the held row's resolution. {'{scan.target}'} is the bound value; {'{subject.<facet>}'} reads the held row.
          </span>
          <textarea
            value={payloadText}
            onChange={(e) => onPayloadChange(e.target.value)}
            rows={3}
            className="textarea w-full font-mono text-sm"
            placeholder={'{ "plateId": "{scan.target}" }'}
            aria-label="Resolver payload"
          />
          {payloadError && <span className="block text-2xs text-status-error mt-1">{payloadError}</span>}
        </label>
      )}
    </>
  );
}
