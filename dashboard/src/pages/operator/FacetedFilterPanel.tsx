import type { FacetFilters, FacetRange, FacetOrder } from '../../api/escalations';

const RANGE_OPS: FacetRange['op'][] = ['<', '<=', '>', '>=', '='];
const SORT_COLUMNS = ['priority', 'created_at', 'updated_at', 'status', 'role'];

const inputCls =
  'h-7 rounded border border-surface-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none';
const xBtn = 'text-text-tertiary hover:text-text-primary transition-colors';

/** A facet value is JSONB-containment-sensitive: 0.65 (number) ≠ "0.65" (string). */
function coerce(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

type KV = { key: string; value: string };
const recordRows = (rec?: Record<string, unknown>): KV[] =>
  Object.entries(rec ?? {}).map(([key, value]) => ({ key, value: String(value) }));
const blockRows = (arr?: Record<string, unknown>[]): KV[] =>
  (arr ?? []).map((o) => {
    const [key, value] = Object.entries(o)[0] ?? ['', ''];
    return { key, value: String(value) };
  });

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-surface-border/50 py-3 first:border-t-0 first:pt-1">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{title}</span>
        {hint && <span className="text-[10px] font-mono text-text-tertiary/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function KeyInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <input
      list="lt-facet-keys" className={`${inputCls} w-40`} placeholder={placeholder}
      value={value} onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Faceted query editor — the advanced operations surface (rendered inside the
 * slide-out drawer). Controlled: edits a FacetFilters value. `facetKeys` are the
 * metadata keys that actually exist in the caller's rows (from listFacetKeys), so
 * the UI never offers a non-existent facet.
 */
export function FacetedFilterPanel({ value, onChange, facetKeys = [], search = '', onSearchChange }: {
  value: FacetFilters;
  onChange: (next: FacetFilters) => void;
  facetKeys?: string[];
  /** Correlation-id term — exact match on escalation id / workflow id / origin id, composed
   *  with the facets in the same SQL query. Not a substring search; for values inside metadata
   *  use a facet. */
  search?: string;
  onSearchChange?: (next: string) => void;
}) {
  const facets = recordRows(value.facets);
  const exclude = blockRows(value.block);
  const ranges = value.range ?? [];
  const exists = value.exists ?? [];
  const sorts = value.orderBy ?? [];

  const setFacets = (rows: KV[]) => {
    const rec: Record<string, unknown> = {};
    for (const r of rows) if (r.key) rec[r.key] = coerce(r.value);
    onChange({ ...value, facets: Object.keys(rec).length ? rec : undefined });
  };
  const setBlock = (rows: KV[]) => {
    const arr = rows.filter((r) => r.key).map((r) => ({ [r.key]: coerce(r.value) }));
    onChange({ ...value, block: arr.length ? arr : undefined });
  };
  const setRange = (r: FacetRange[]) => onChange({ ...value, range: r.length ? r : undefined });
  const setExists = (e: string[]) => onChange({ ...value, exists: e.length ? e : undefined });
  const setSorts = (o: FacetOrder[]) => onChange({ ...value, orderBy: o.length ? o : undefined });

  return (
    <div className="text-xs">
      {/* Autocomplete sources rendered once (shared by all rows). */}
      <datalist id="lt-facet-keys">
        {facetKeys.map((k) => <option key={k} value={k} />)}
      </datalist>
      <datalist id="lt-sort-fields">
        {SORT_COLUMNS.map((c) => <option key={c} value={c} />)}
        {facetKeys.map((k) => <option key={k} value={`metadata.${k}`} />)}
      </datalist>

      {onSearchChange && (
        <Section title="Match id" hint="id · workflow · origin">
          <input
            className={`${inputCls} w-full`}
            placeholder="Exact escalation, workflow, or origin id…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </Section>
      )}

      <Section title="Has facet" hint="metadata @>">
        {[...facets, { key: '', value: '' }].map((row, i) => (
          <div key={i} className="mb-1 flex items-center gap-1">
            <KeyInput value={row.key} placeholder="key"
              onChange={(k) => { const next = [...facets]; next[i] = { ...row, key: k }; setFacets(next); }} />
            <span className="text-text-tertiary">=</span>
            <input className={`${inputCls} w-40`} placeholder="value" value={row.value}
              onChange={(e) => { const next = [...facets]; next[i] = { ...row, value: e.target.value }; setFacets(next); }} />
            {i < facets.length && (
              <button className={xBtn} onClick={() => setFacets(facets.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Range" hint="numeric">
        {[...ranges, { facet: '', op: '<=' as const, value: 0 }].map((r, i) => (
          <div key={i} className="mb-1 flex items-center gap-1">
            <KeyInput value={r.facet} placeholder="numeric facet"
              onChange={(f) => { const next = [...ranges]; next[i] = { ...r, facet: f }; setRange(next.filter((x) => x.facet)); }} />
            <select className={inputCls} value={r.op}
              onChange={(e) => { const next = [...ranges]; next[i] = { ...r, op: e.target.value as FacetRange['op'] }; setRange(next.filter((x) => x.facet)); }}>
              {RANGE_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input type="number" className={`${inputCls} w-24`} value={r.value}
              onChange={(e) => { const next = [...ranges]; next[i] = { ...r, value: Number(e.target.value) }; setRange(next.filter((x) => x.facet)); }} />
            {i < ranges.length && (
              <button className={xBtn} onClick={() => setRange(ranges.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Has key" hint="metadata ? key">
        <div className="flex flex-wrap items-center gap-1">
          {exists.map((k) => (
            <span key={k} className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-accent">
              {k}<button className="text-accent/70 hover:text-accent" onClick={() => setExists(exists.filter((x) => x !== k))}>×</button>
            </span>
          ))}
          <KeyInput value="" placeholder="+ key"
            onChange={(k) => { if (k && !exists.includes(k)) setExists([...exists, k]); }} />
        </div>
      </Section>

      <Section title="Exclude" hint="NOT @>">
        {[...exclude, { key: '', value: '' }].map((row, i) => (
          <div key={i} className="mb-1 flex items-center gap-1">
            <KeyInput value={row.key} placeholder="key"
              onChange={(k) => { const next = [...exclude]; next[i] = { ...row, key: k }; setBlock(next); }} />
            <span className="text-text-tertiary">=</span>
            <input className={`${inputCls} w-40`} placeholder="value" value={row.value}
              onChange={(e) => { const next = [...exclude]; next[i] = { ...row, value: e.target.value }; setBlock(next); }} />
            {i < exclude.length && (
              <button className={xBtn} onClick={() => setBlock(exclude.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Sort by">
        {[...sorts, { field: '', direction: 'asc' as const }].map((s, i) => (
          <div key={i} className="mb-1 flex items-center gap-1">
            <input list="lt-sort-fields" className={`${inputCls} w-44`} placeholder="column or metadata.key"
              value={s.field}
              onChange={(e) => { const next = [...sorts]; next[i] = { ...s, field: e.target.value }; setSorts(next.filter((x) => x.field)); }} />
            <select className={inputCls} value={s.direction ?? 'asc'}
              onChange={(e) => { const next = [...sorts]; next[i] = { ...s, direction: e.target.value as 'asc' | 'desc' }; setSorts(next.filter((x) => x.field)); }}>
              <option value="asc">asc</option><option value="desc">desc</option>
            </select>
            <label className="flex items-center gap-1 text-text-tertiary">
              <input type="checkbox" checked={!!s.numeric}
                onChange={(e) => { const next = [...sorts]; next[i] = { ...s, numeric: e.target.checked }; setSorts(next.filter((x) => x.field)); }} />
              num
            </label>
            {i < sorts.length && (
              <button className={xBtn} onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}
