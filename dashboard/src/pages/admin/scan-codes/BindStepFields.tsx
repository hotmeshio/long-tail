type BindParams = { scheme?: number; facet?: string };

/** A bind step's options: the held row's facet the code binds to, and the scheme the binding is kept under. */
export function BindStepFields({ bind, onBind }: { bind: BindParams; onBind: (bind: BindParams) => void }) {
  return (
    <>
      <label className="block">
        <span className="block text-xs text-text-secondary mb-1">Bind to</span>
        <span className="block text-2xs text-text-tertiary mb-1">Name the held row's facet; blank uses its scheme's target facet.</span>
        <input
          value={bind.facet ?? ''}
          onChange={(e) => {
            const { facet: _f, ...rest } = bind;
            onBind(e.target.value.trim() ? { ...rest, facet: e.target.value.trim() } : rest);
          }}
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
          onChange={(e) => {
            const { scheme: _s, ...rest } = bind;
            onBind(e.target.value ? { ...rest, scheme: Number(e.target.value) } : rest);
          }}
          className="input w-[12rem]"
          aria-label="Keep under scheme"
        />
      </label>
    </>
  );
}
