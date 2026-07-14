import { useState } from 'react';
import { interpolateHelp, type HelpTokenContext } from '../../lib/x-lt-help';
import { ArrowRight } from 'lucide-react';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';
import { STATUS_DOT_STYLES } from '../common/display/StatusBadge';
import { DateValue } from '../common/display/DateValue';
import { useEscalations } from '../../api/escalations';
import { isEffectivelyClaimed } from '../../lib/escalation';
import type { LTEscalationRecord } from '../../api/types';

/**
 * EscalationListView — the role-authored rich view of an escalation list, driven
 * by a versioned `list_schema` (x-lt-* markup). The list-page analog of the
 * resolve form: the same `{{domain.path}}` token binding (via interpolateHelp)
 * against each row's context, and MarkdownRenderer for rich bodies.
 *
 * Flagship layout `active-history`: the single live (non-terminal) escalation
 * rendered as a card on the left, and a history column on the right that is NOT
 * auto-loaded — a "Load full history" link fetches resolved items on demand.
 */

interface CardDef {
  title?: string;
  subtitle?: string;
  body?: string;
  fields?: { label: string; value: string }[];
}

interface HistoryDef {
  row?: { title?: string; subtitle?: string; meta?: string };
  limit?: number;
  status?: string;
}

interface ListSchema {
  'x-lt-layout'?: string;
  'x-lt-help'?: string;
  'x-lt-active'?: CardDef;
  'x-lt-history'?: HistoryDef;
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
 * Render an interpolated field value with a little care: a full ISO datetime
 * becomes a friendly, hoverable date; an empty value a quiet em dash; anything
 * else plain text. Authors bind tokens; we make the common shapes look right.
 */
function FieldValue({ raw }: { raw: string }) {
  if (!raw || raw === EM_DASH) return <span className="text-text-quaternary">{EM_DASH}</span>;
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
          <h3 className="text-2xl font-light text-text-primary group-hover:text-accent transition-colors leading-tight">
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
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">{f.label}</dt>
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
                  <span className="block text-[10px] text-text-tertiary truncate">
                    {interpolateHelp(rowDef.subtitle, ctx)}
                  </span>
                )}
              </span>
              {rowDef.meta
                ? <span className="text-[10px] text-text-tertiary shrink-0">{interpolateHelp(rowDef.meta, ctx)}</span>
                : e.resolved_at && <DateValue date={e.resolved_at} format="relative" className="text-[10px] text-text-tertiary shrink-0 whitespace-nowrap" />}
            </button>
          );
        })}
      </div>
      {total > rows.length && (
        <p className="text-[10px] text-text-quaternary mt-3">Showing {rows.length} of {total}.</p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-3">{children}</p>
  );
}

export function EscalationListView({ role, listSchema, activeEscalations, onRowClick }: {
  role: string;
  listSchema: ListSchema;
  activeEscalations: LTEscalationRecord[];
  onRowClick?: (row: LTEscalationRecord) => void;
}) {
  const layout = listSchema['x-lt-layout'];
  const card = listSchema['x-lt-active'] ?? {};
  const active = activeEscalations[0];
  const help = listSchema['x-lt-help'];

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
