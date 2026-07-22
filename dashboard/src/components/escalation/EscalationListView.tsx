import { useState, useEffect } from 'react';
import { interpolateHelp, type HelpTokenContext } from '../../lib/x-lt-help';
import { ArrowRight, ListFilter, Search } from 'lucide-react';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { STATUS_DOT_STYLES } from '../common/display/StatusBadge';
import { DateValue } from '../common/display/DateValue';
import { StickyPagination } from '../common/data/StickyPagination';
import { useEscalations } from '../../api/escalations';
import { isEffectivelyClaimed } from '../../lib/escalation';
import { formatAgoCompact } from '../../lib/format';
import { metadataFacetUrl } from '../../lib/facet-url';
import { getDeep } from '../../lib/x-lt-bind';
import { typeColor } from '../../lib/type-color';
import type { LTEscalationRecord } from '../../api/types';

/**
 * EscalationListView — the role-authored rich view of an escalation list, driven
 * by a versioned `list_schema` (x-lt-* markup). The list-page analog of the
 * resolve form: the same `{{domain.path}}` token binding (via interpolateHelp)
 * against each row's context, and MarkdownRenderer for rich bodies.
 *
 * Layouts:
 *   active-history  — single live item as a card on the left + history column on right
 *   active          — just the single live item card (no history)
 *   facet-table     — full pending queue as a table, columns from x-lt-columns
 *   facet-board     — one card per x-lt-group-by facet value (an entity board:
 *                     machines, stations), rendered from each group's latest row
 */

interface CardDef {
  title?: string;
  subtitle?: string;
  body?: string;
  fields?: { label: string; value: string; format?: string }[];
}

interface HistoryDef {
  row?: { title?: string; subtitle?: string; meta?: string };
  limit?: number;
  status?: string;
}

export interface ColumnDef {
  label: string;
  value: string;
  /** "age" renders an ISO timestamp as a compact age with an absolute tooltip. */
  format?: string;
}

interface BoardCardDef {
  title?: string;
  /** Status chip — any token (commonly {{escalation.subtype}}). */
  state?: string;
  fields?: { label: string; value: string; format?: string }[];
}

interface ListSchema {
  'x-lt-layout'?: string;
  'x-lt-help'?: string;
  'x-lt-active'?: CardDef;
  'x-lt-history'?: HistoryDef;
  'x-lt-columns'?: ColumnDef[];
  /** facet-board: the "domain.path" whose value identifies each entity. */
  'x-lt-group-by'?: string;
  /** facet-board: the per-entity card definition. */
  'x-lt-card'?: BoardCardDef;
}

/**
 * Repaint-only minute tick so `format: "age"` values stay current. Pure
 * re-render — no network. Mounted once at the view root, only when the
 * schema actually uses ages.
 */
function useAgeTick(enabled: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [enabled]);
}

function schemaUsesAge(schema: ListSchema): boolean {
  return [...(schema['x-lt-columns'] ?? []), ...(schema['x-lt-card']?.fields ?? [])]
    .some((f) => f.format === 'age');
}

/** Build the token context for one escalation row (payloads are JSON strings). */
export function rowContext(e: LTEscalationRecord): HelpTokenContext {
  const parse = (s: string | null | undefined): Record<string, unknown> | null => {
    if (!s) return null;
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  };
  return {
    escalation: e as unknown as Record<string, unknown>,
    metadata: e.metadata ?? null,
    envelope: parse(e.envelope),
    payload: parse(e.escalation_payload),
    resolver: parse(e.resolver_payload),
  };
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const EM_DASH = '—';

/**
 * Render an interpolated field value with a little care: `format: "age"` turns
 * a timestamp into a compact age ("12m", "3h") with the absolute time as its
 * tooltip; a full ISO datetime becomes a friendly, hoverable date; an empty
 * value a quiet em dash; anything else plain text. Authors bind tokens; we
 * make the common shapes look right.
 */
function FieldValue({ raw, format }: { raw: string; format?: string }) {
  if (!raw || raw === EM_DASH) return <span className="text-text-quaternary">{EM_DASH}</span>;
  if (format === 'age') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return <span title={d.toLocaleString()} className="tabular-nums whitespace-nowrap">{formatAgoCompact(raw)}</span>;
    }
  }
  if (ISO_DATETIME.test(raw)) return <DateValue date={raw} format="datetime" className="text-text-primary" />;
  return <>{raw}</>;
}

function ActiveCard({ esc, card, onOpen }: {
  esc: LTEscalationRecord;
  card: CardDef;
  onOpen?: () => void;
}) {
  const ctx = rowContext(esc);
  const title = card.title ? interpolateHelp(card.title, ctx) : esc.type;
  const claimable = esc.status === 'pending' && !isEffectivelyClaimed(esc);
  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <button onClick={onOpen} className="text-left group min-w-0">
          <h3 className="heading-2 group-hover:text-accent transition-colors leading-tight">
            {title}
          </h3>
          {card.subtitle && (
            <p className="text-xs text-text-tertiary mt-1.5">{interpolateHelp(card.subtitle, ctx)}</p>
          )}
        </button>

        {/* Explicit way through to the detail page to claim the open item. */}
        {claimable && (
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent text-text-inverse text-xs font-medium hover:bg-accent-hover transition-colors shrink-0"
          >
            Claim
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {card.fields && card.fields.length > 0 && (
        <dl className="flex flex-wrap gap-x-10 gap-y-4 mt-6">
          {card.fields.map((f, i) => (
            <div key={i}>
              <dt className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{f.label}</dt>
              <dd className="text-xs text-text-primary mt-1"><FieldValue raw={interpolateHelp(f.value, ctx)} /></dd>
            </div>
          ))}
        </dl>
      )}

      {card.body && (
        <div className="mt-7 pt-6 border-t border-surface-border/50">
          <MarkdownRenderer content={interpolateHelp(card.body, ctx)} />
        </div>
      )}
    </div>
  );
}

function HistoryColumn({ role, def, onRowClick }: {
  role: string;
  def: HistoryDef;
  onRowClick?: (row: LTEscalationRecord) => void;
}) {
  const [show, setShow] = useState(false);
  const query = useEscalations({
    role,
    status: def.status ?? 'resolved',
    sort_by: 'resolved_at',
    order: 'desc',
    limit: def.limit ?? 25,
    enabled: show,
  });
  const rows = query.data?.escalations ?? [];
  const total = query.data?.total ?? 0;
  const rowDef = def.row ?? {};

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="text-xs text-accent hover:underline"
        data-testid="load-history"
      >
        Load full history →
      </button>
    );
  }

  if (query.isLoading) {
    return <p className="text-xs text-text-tertiary italic">Loading history…</p>;
  }

  if (rows.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No past revisions.</p>;
  }

  return (
    <div>
      <div className="divide-y divide-surface-border/40">
        {rows.map((e) => {
          const ctx = rowContext(e);
          return (
            <button
              key={e.id}
              onClick={() => onRowClick?.(e)}
              className="w-full text-left py-2.5 group flex items-center gap-3"
            >
              {/* Status as a bare outlined dot — colour carries the meaning. */}
              <span
                className={`w-1.5 h-1.5 shrink-0 rounded-full dot-ring ${STATUS_DOT_STYLES[e.status] ?? 'bg-status-pending'}`}
                title={e.status}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-text-primary group-hover:text-accent transition-colors truncate">
                  {rowDef.title ? interpolateHelp(rowDef.title, ctx) : e.type}
                </span>
                {rowDef.subtitle && (
                  <span className="block text-2xs text-text-tertiary truncate">
                    {interpolateHelp(rowDef.subtitle, ctx)}
                  </span>
                )}
              </span>
              {rowDef.meta
                ? <span className="text-2xs text-text-tertiary shrink-0">{interpolateHelp(rowDef.meta, ctx)}</span>
                : e.resolved_at && <DateValue date={e.resolved_at} format="relative" className="text-2xs text-text-tertiary shrink-0 whitespace-nowrap" />}
            </button>
          );
        })}
      </div>
      {total > rows.length && (
        <p className="text-2xs text-text-quaternary mt-3">Showing {rows.length} of {total}.</p>
      )}
    </div>
  );
}

/** Multi-row pending queue as a facet table. Columns defined by x-lt-columns. */
function FacetTable({ schema, rows, onRowClick }: {
  schema: ListSchema;
  rows: LTEscalationRecord[];
  onRowClick?: (row: LTEscalationRecord) => void;
}) {
  const columns = schema['x-lt-columns'] ?? [];

  if (rows.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No pending items.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-surface-border/60">
            <th className="w-4 pb-2 pr-3" aria-label="Status" />
            {columns.map((col, i) => (
              <th
                key={i}
                className="text-left pb-2 pr-8 text-2xs font-semibold uppercase tracking-widest text-text-tertiary whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border/30">
          {rows.map((row) => {
            const ctx = rowContext(row);
            return (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? 'group cursor-pointer hover:bg-surface-hover' : 'group'}
                data-testid="facet-table-row"
              >
                <td className="py-2.5 pr-3">
                  <span
                    className={`w-1.5 h-1.5 inline-block rounded-full dot-ring ${STATUS_DOT_STYLES[row.status] ?? 'bg-status-pending'}`}
                    title={row.status}
                  />
                </td>
                {columns.map((col, i) => (
                  <td
                    key={i}
                    className="py-2.5 pr-8 text-text-secondary group-hover:text-text-primary transition-colors"
                  >
                    <FieldValue raw={interpolateHelp(col.value, ctx)} format={col.format} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>
  );
}

// ── facet-board — one card per entity (machine, station) ─────────────────────

interface BoardGroup {
  key: string;
  /** The group's identity as stored (native type preserved for the facet URL). */
  rawValue: unknown;
  latest: LTEscalationRecord;
  count: number;
}

/**
 * Group rows by the resolved x-lt-group-by value; each card renders from the
 * group's most recent row (by created_at). Rows without the facet are skipped —
 * the board reflects the scope, it doesn't invent entities.
 */
export function groupBoardRows(rows: LTEscalationRecord[], groupBy: string): BoardGroup[] {
  const dot = groupBy.indexOf('.');
  const facetKey = groupBy.startsWith('metadata.') ? groupBy.slice('metadata.'.length) : null;
  const groups = new Map<string, BoardGroup>();
  for (const row of rows) {
    const ctx = rowContext(row);
    let v: unknown;
    try {
      v = dot === -1
        ? (ctx as unknown as Record<string, unknown>)[groupBy]
        : getDeep((ctx as unknown as Record<string, unknown>)[groupBy.slice(0, dot)], groupBy.slice(dot + 1));
    } catch {
      v = undefined;
    }
    if (v === undefined || v === null || v === '') continue;
    const key = String(v);
    const rawValue = facetKey ? (row.metadata?.[facetKey] ?? v) : v;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, rawValue, latest: row, count: 1 });
    } else {
      existing.count += 1;
      if (new Date(row.created_at) > new Date(existing.latest.created_at)) existing.latest = row;
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** A field value token that is a pure metadata binding — facet-linkable. */
const METADATA_TOKEN = /^\{\{\s*metadata\.([a-zA-Z0-9_]+)\s*\}\}$/;

function FacetBoard({ schema, rows, role, onOpenDetail, onOpenGroup, onAddFacet }: {
  schema: ListSchema;
  rows: LTEscalationRecord[];
  role: string;
  /** Plain card click — the group's latest row opens in the detail view. */
  onOpenDetail?: (row: LTEscalationRecord) => void;
  /** History affordances — receive a filtered table/timeline deep link. */
  onOpenGroup?: (url: string) => void;
  /** Shift+click — merge one facet into the live filter set (additive). */
  onAddFacet?: (key: string, value: unknown) => void;
}) {
  const groupBy = schema['x-lt-group-by'];
  const card = schema['x-lt-card'] ?? {};

  if (!groupBy) {
    return <p className="text-xs text-text-tertiary italic">facet-board needs an x-lt-group-by path.</p>;
  }
  const facetKey = groupBy.startsWith('metadata.') ? groupBy.slice('metadata.'.length) : null;
  const groups = groupBoardRows(rows, groupBy);
  if (groups.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No entities in scope.</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" data-testid="facet-board">
      {groups.map((g) => {
        const ctx = rowContext(g.latest);
        const title = card.title ? interpolateHelp(card.title, ctx) : g.key;
        const state = card.state ? interpolateHelp(card.state, ctx) : (g.latest.subtype || g.latest.status);
        const stateHue = typeColor(state);

        const activate = (e: { shiftKey: boolean }) => {
          if (e.shiftKey && facetKey && onAddFacet) {
            onAddFacet(facetKey, g.rawValue);
            return;
          }
          onOpenDetail?.(g.latest);
        };

        return (
          <div
            key={g.key}
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); }
            }}
            title={facetKey ? 'Open the latest item · ⇧ click to filter the board' : 'Open the latest item'}
            className="group/card border-l-2 border-accent/30 bg-surface-sunken/40 rounded-[0.125em] px-4 py-3.5 cursor-pointer transition-colors hover:bg-surface-sunken/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            data-testid="facet-board-card"
          >
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-text-secondary truncate">
                {title}
              </span>
              <span
                className="shrink-0 px-1.5 py-0.5 rounded text-2xs font-mono font-medium"
                style={{ color: stateHue.text, backgroundColor: stateHue.bg }}
                title={state}
              >
                {state}
              </span>
            </div>
            {card.fields && card.fields.length > 0 && (
              <dl className="space-y-1">
                {card.fields.map((f, i) => {
                  // Pure metadata bindings get the same hover filter affordance
                  // the table's MetadataCell offers; ⇧ click adds instead of replacing.
                  const bound = f.value.match(METADATA_TOKEN)?.[1];
                  const raw = bound ? g.latest.metadata?.[bound] : undefined;
                  const linkable = bound != null && raw !== undefined && raw !== null && raw !== '';
                  return (
                    <div key={i} className="group/frow flex items-baseline justify-between gap-3">
                      <dt className="text-2xs uppercase tracking-wider text-text-quaternary shrink-0">{f.label}</dt>
                      <dd className="min-w-0 flex items-baseline gap-1 text-2xs text-text-primary">
                        <span className="truncate">
                          <FieldValue raw={interpolateHelp(f.value, ctx)} format={f.format} />
                        </span>
                        {/* Fixed-width trailing slot on EVERY row — linkable rows
                            fill it with the filter/search pair the table's
                            metadata cells offer — so all values share one right
                            rail regardless of linkability. */}
                        <span className="shrink-0 w-9 self-center flex items-center justify-end gap-px">
                          {linkable && (onOpenGroup || onAddFacet) && (
                            <span className="flex items-center gap-px opacity-0 group-hover/frow:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (e.shiftKey && onAddFacet) onAddFacet(bound, raw);
                                  else onOpenGroup?.(metadataFacetUrl(bound, raw, role));
                                }}
                                className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                                title={`Filter ${role}: ${bound} = ${String(raw)} · ⇧ click adds to current filters`}
                                data-testid="facet-field-filter"
                              >
                                <ListFilter className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenGroup?.(metadataFacetUrl(bound, raw));
                                }}
                                className="p-0.5 rounded text-text-quaternary hover:text-accent transition-colors"
                                title={`Search all: ${bound} = ${String(raw)}`}
                                data-testid="facet-field-search"
                              >
                                <Search className="w-3 h-3" />
                              </button>
                            </span>
                          )}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}

          </div>
        );
      })}
    </div>
  );
}

export function EscalationListView({ role, listSchema, activeEscalations, onRowClick, onOpenGroup, onAddFacet, total, page, totalPages, pageSize, onPageChange, onPageSizeChange }: {
  role: string;
  listSchema: ListSchema;
  activeEscalations: LTEscalationRecord[];
  onRowClick?: (row: LTEscalationRecord) => void;
  /** facet-board history affordances — receive a filtered deep link. */
  onOpenGroup?: (url: string) => void;
  /** facet-board ⇧ click — merge one facet into the live filter set. */
  onAddFacet?: (key: string, value: unknown) => void;
  total?: number;
  page?: number;
  totalPages?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const layout = listSchema['x-lt-layout'];
  const card = listSchema['x-lt-active'] ?? {};
  const active = activeEscalations[0];
  const help = listSchema['x-lt-help'];
  useAgeTick(schemaUsesAge(listSchema));

  const activeBlock = active ? (
    <ActiveCard esc={active} card={card} onOpen={() => onRowClick?.(active)} />
  ) : (
    <p className="text-xs text-text-tertiary italic">No active item right now.</p>
  );

  const header = help && active ? (
    <div className="mb-8"><MarkdownRenderer content={interpolateHelp(help, rowContext(active))} /></div>
  ) : help ? (
    <div className="mb-8"><MarkdownRenderer content={help} /></div>
  ) : null;

  if (layout === 'facet-table') {
    const resolvedTotal = total ?? activeEscalations.length;
    return (
      <div>
        {header}
        {resolvedTotal > 0 && (
          <p className="text-2xs text-text-tertiary mb-3 tabular-nums">
            {resolvedTotal.toLocaleString()} result{resolvedTotal !== 1 ? 's' : ''}
          </p>
        )}
        <FacetTable schema={listSchema} rows={activeEscalations} onRowClick={onRowClick} />
        {page !== undefined && totalPages !== undefined && onPageChange && (
          <StickyPagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            total={resolvedTotal}
            pageSize={pageSize ?? 25}
            onPageSizeChange={onPageSizeChange}
          />
        )}
      </div>
    );
  }

  if (layout === 'facet-board') {
    return (
      <div>
        {header}
        <FacetBoard
          schema={listSchema}
          rows={activeEscalations}
          role={role}
          onOpenDetail={onRowClick}
          onOpenGroup={onOpenGroup}
          onAddFacet={onAddFacet}
        />
        {page !== undefined && totalPages !== undefined && onPageChange && totalPages > 1 && (
          <StickyPagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            total={total ?? activeEscalations.length}
            pageSize={pageSize ?? 25}
            onPageSizeChange={onPageSizeChange}
          />
        )}
      </div>
    );
  }

  if (layout === 'active-history') {
    return (
      <div>
        {header}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-12 items-start">
          <div>
            <SectionLabel>Active</SectionLabel>
            {activeBlock}
          </div>
          <div>
            <SectionLabel>History</SectionLabel>
            <HistoryColumn role={role} def={listSchema['x-lt-history'] ?? {}} onRowClick={onRowClick} />
          </div>
        </div>
      </div>
    );
  }

  // "active" (or any non-table layout): just the active card.
  return (
    <div>
      {header}
      {activeBlock}
    </div>
  );
}
