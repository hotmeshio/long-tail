import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, LayoutGrid } from 'lucide-react';
import { PORTAL_LIMITS, type PortalCount, type RoleDetail, type RolePin, type RolePortal } from '../../../../api/roles';
import { usePreferences } from '../../../../api/preferences';
import { useLinkVariables } from '../../../../hooks/useLinkVariables';
import { extractLinkVarNames } from '../../../../lib/link-vars';
import { parseEscalationListUrl } from '../../../../lib/escalation-list-url';
import { portalKeyFor, portalPath } from '../../../../lib/portal-path';
import { SectionGroup, type Draft } from '../role-detail-shared';

const PICK = {
  ROLE: 'role',
  MINE: 'mine',
  CUSTOM: 'custom',
} as const;
type PickSource = (typeof PICK)[keyof typeof PICK];

interface PickOption {
  key: string;
  source: PickSource;
  pin: RolePin;
}

// The editor draws what it produces: the portal page's sheet and title band
// for each portal, the same recipe at cell scale for each panel, and dashed
// placeholders shaped like a cell wherever a view can be added.
const SHEET = 'border border-surface-border bg-surface-sunken rounded-[var(--lt-radius-section)] overflow-hidden';
const BAND = 'flex items-center gap-3 px-4 py-2.5 border-b border-surface-border bg-surface-hover';
const CELL_BAND = 'flex items-center gap-2 px-3 py-2 border-b border-surface-border bg-surface-hover';
const PLACEHOLDER = 'border border-dashed border-surface-border rounded-[var(--lt-radius-section)] flex items-center justify-center p-3 min-w-0 overflow-hidden';

/** The presentation a pin asks for, as a short chip; a pin with no view follows the role's default. */
function viewChip(url: string): string {
  const params = parseEscalationListUrl(url);
  if (!params) return 'page';
  const view = params.view ?? 'default';
  return params.layout ? `${view} · ${params.layout}` : view;
}

/**
 * The role's portals, composed from pins. Each portal is a named matrix:
 * rows of cells, each cell a pinned view picked from the role's default pins
 * or the admin's own pins, or typed as a label and URL. Edits build the
 * page's draft; Save writes them with the rest of the role. Members choose a
 * portal from the global menu; a kiosk role lands on the first one.
 */
export function PortalSection({ role, draft, update }: {
  role: RoleDetail;
  draft: Draft;
  update: (changes: Partial<Draft>) => void;
}) {
  const { data: prefs } = usePreferences();
  const { values, defaults } = useLinkVariables();
  const portals = draft.portals;
  const [newLabel, setNewLabel] = useState('');

  const options = useMemo<PickOption[]>(() => [
    ...(role.default_pins ?? []).map((pin, i) => ({ key: `${PICK.ROLE}:${i}`, source: PICK.ROLE, pin })),
    ...(prefs?.preferences?.pinnedViews ?? []).map((pin) => ({
      key: `${PICK.MINE}:${pin.id}`, source: PICK.MINE, pin: { label: pin.label, url: pin.url, badge: pin.badge },
    })),
  ], [role.default_pins, prefs]);

  const save = (next: RolePortal[]) => update({ portals: next });
  const replacePortal = (index: number, portal: RolePortal | null) =>
    save(portals.flatMap((p, i) => (i === index ? (portal ? [portal] : []) : [p])));

  // A new portal needs its first cell to be valid, so it starts from the first pick.
  const startPortal = (pin: RolePin) => {
    const label = newLabel.trim() || `Portal ${portals.length + 1}`;
    save([...portals, { key: portalKeyFor(label, portals.map((p) => p.key)), label, rows: [[pin]] }]);
    setNewLabel('');
  };

  return (
    <SectionGroup
      icon={LayoutGrid}
      label="Portals"
      annotation="named pages of pinned views, one row of panels per matrix row"
      accent
    >
      <div className="space-y-6">
        {portals.length === 0 && (
          <p className="text-2xs text-text-tertiary leading-relaxed">
            A portal lays pins out as one page: one row with one view fills the screen, a row with three views splits it into three columns.
            Give a role several: urgent items by facility for the floor screen, the day's focus for the team with a panel per person.
            Members choose one from the global menu; a kiosk role lands on the first. Save writes the portals with the rest of the role.
          </p>
        )}

        {portals.map((portal, index) => (
          <PortalEditor
            key={portal.key}
            role={role.role}
            portal={portal}
            options={options}
            bindings={{ values, defaults }}
            onChange={(next) => replacePortal(index, next)}
          />
        ))}

        {portals.length < PORTAL_LIMITS.MAX_PORTALS && (
          <div className={`${PLACEHOLDER} flex-wrap gap-3 py-5`} data-testid="new-portal">
            <span className="text-2xs font-semibold uppercase tracking-widest text-text-quaternary">New portal</span>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Name, e.g. Focus of the day"
              className="input text-xs w-52 shrink-0"
              aria-label="New portal name"
            />
            <CellPicker options={options} label="Start it with a view" onPick={startPortal} testId="add-portal" />
          </div>
        )}

      </div>
    </SectionGroup>
  );
}

function PortalEditor({ role, portal, options, bindings, onChange }: {
  role: string;
  portal: RolePortal;
  options: PickOption[];
  bindings: { values: Record<string, string>; defaults: Record<string, string> };
  onChange: (next: RolePortal | null) => void;
}) {
  const [label, setLabel] = useState(portal.label);
  const rows = portal.rows;

  const setRows = (next: RolePin[][]) => {
    const kept = next.filter((r) => r.length > 0);
    onChange(kept.length ? { ...portal, rows: kept } : null);
  };
  const addCell = (rowIndex: number, pin: RolePin) => {
    const next = rows.map((r) => [...r]);
    if (rowIndex >= next.length) next.push([pin]); else next[rowIndex].push(pin);
    setRows(next);
  };
  const removeCell = (rowIndex: number, cellIndex: number) => {
    const next = rows.map((r) => [...r]);
    next[rowIndex].splice(cellIndex, 1);
    setRows(next);
  };
  const renameCell = (rowIndex: number, cellIndex: number, cellLabel: string) => {
    if (!cellLabel.trim()) return;
    const next = rows.map((r) => r.map((c) => ({ ...c })));
    next[rowIndex][cellIndex].label = cellLabel.trim();
    onChange({ ...portal, rows: next });
  };
  const commitLabel = () => {
    const trimmed = label.trim();
    if (!trimmed) { setLabel(portal.label); return; }
    if (trimmed !== portal.label) onChange({ ...portal, label: trimmed });
  };

  const counts = portal.counts ?? [];
  const setCounts = (next: PortalCount[]) =>
    onChange(next.length ? { ...portal, counts: next } : (({ counts: _dropped, ...rest }) => rest)(portal));
  const addCount = (pin: RolePin) => setCounts([...counts, { label: pin.label, url: pin.url }]);
  const editCount = (index: number, patch: Partial<PortalCount>) =>
    setCounts(counts.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <section className={SHEET} data-testid={`portal-${portal.key}`}>
      <div className={BAND}>
        <PortalSketch rows={rows} />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="input text-xs w-52"
          aria-label={`Portal name for ${portal.key}`}
        />
        <span className="font-mono text-2xs text-text-quaternary truncate" title="The portal's address segment">{portal.key}</span>
        <Link to={portalPath(role, portal.key)} className="ml-auto inline-flex items-center gap-1 text-2xs text-accent hover:underline shrink-0" data-testid={`open-portal-${portal.key}`}>
          Open <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
        </Link>
        <button
          onClick={() => onChange(null)}
          className="text-text-quaternary hover:text-status-error transition-colors leading-none shrink-0"
          aria-label={`Remove portal ${portal.label}`}
          title="Remove this portal"
        >
          ×
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Counts lead the page: a tile per list URL, its live total under a label and over a blurb. */}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${counts.length}, minmax(0, 1fr))${counts.length < PORTAL_LIMITS.MAX_COUNTS ? ' 12rem' : ''}` }}
          data-testid={`portal-${portal.key}-counts`}
        >
          {counts.map((count, i) => (
            <div key={`${count.url}-${i}`} className={`${SHEET} min-w-0 bg-surface-raised px-3 py-2 space-y-1.5`} data-testid={`portal-${portal.key}-count-${i}`}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  defaultValue={count.label}
                  onBlur={(e) => { if (e.target.value.trim()) editCount(i, { label: e.target.value.trim() }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="input text-2xs py-0.5 px-1.5 min-w-0 flex-1 uppercase tracking-widest"
                  aria-label={`Count title ${i + 1} of ${portal.label}`}
                />
                <button
                  onClick={() => setCounts(counts.filter((_, j) => j !== i))}
                  className="text-text-quaternary hover:text-status-error transition-colors leading-none shrink-0"
                  aria-label={`Remove count ${count.label} from ${portal.label}`}
                  title="Remove this count"
                >
                  ×
                </button>
              </div>
              <input
                type="text"
                defaultValue={count.blurb ?? ''}
                onBlur={(e) => editCount(i, { blurb: e.target.value.trim() || undefined })}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="One line under the number"
                className="input text-xs py-0.5 px-1.5 w-full"
                aria-label={`Count blurb ${i + 1} of ${portal.label}`}
              />
              <p className="font-mono text-2xs text-text-quaternary truncate" title={count.url}>{count.url}</p>
            </div>
          ))}
          {counts.length < PORTAL_LIMITS.MAX_COUNTS && (
            <div className={PLACEHOLDER}>
              <CellPicker options={options} label={counts.length === 0 ? 'Add a count above the panels' : 'Add a count'} onPick={addCount} testId={`add-count-${portal.key}`} />
            </div>
          )}
        </div>

        {rows.map((row, r) => {
          const canAddCell = row.length < PORTAL_LIMITS.MAX_COLS;
          return (
            <div
              key={r}
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))${canAddCell ? ' 12rem' : ''}` }}
              data-testid={`portal-${portal.key}-row-${r}`}
            >
              {row.map((cell, c) => {
                const varNames = extractLinkVarNames(cell.url);
                return (
                  <div key={`${r}-${c}`} className={`${SHEET} min-w-0 bg-surface-raised`} data-testid={`portal-${portal.key}-cell-${r}-${c}`}>
                    <div className={CELL_BAND}>
                      <input
                        type="text"
                        defaultValue={cell.label}
                        onBlur={(e) => renameCell(r, c, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="input text-xs py-0.5 px-1.5 min-w-0 flex-1 font-medium"
                        aria-label={`Panel title for row ${r + 1} cell ${c + 1}`}
                        title="The panel's title; rename it for the person or place it serves"
                      />
                      <span className="text-2xs text-accent shrink-0" title="The view this pin asks for">{viewChip(cell.url)}</span>
                      <button
                        onClick={() => removeCell(r, c)}
                        className="text-text-quaternary hover:text-status-error transition-colors leading-none shrink-0"
                        aria-label={`Remove ${cell.label} from row ${r + 1} of ${portal.label}`}
                        title="Remove this panel"
                      >
                        ×
                      </button>
                    </div>
                    <div className="px-3 py-2 space-y-0.5">
                      <p className="font-mono text-2xs text-text-quaternary truncate" title={cell.url}>{cell.url}</p>
                      {varNames.length > 0 && (
                        <p className="font-mono text-2xs text-text-quaternary">
                          {varNames.map((n) => {
                            const bound = bindings.values[n] ?? bindings.defaults[n];
                            return `${n} = ${bound ? `'${bound}'` : '<empty>'}`;
                          }).join(', ')}
                          <span className="font-sans"> on this device</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {canAddCell && (
                <div className={PLACEHOLDER}>
                  <CellPicker options={options} label="Add a view to this row" onPick={(pin) => addCell(r, pin)} testId={`add-cell-${portal.key}-${r}`} />
                </div>
              )}
            </div>
          );
        })}

        {rows.length < PORTAL_LIMITS.MAX_ROWS && (
          <div className={`${PLACEHOLDER} py-4`}>
            <CellPicker options={options} label="Start a new row with a view" onPick={(pin) => addCell(rows.length, pin)} testId={`add-row-${portal.key}`} />
          </div>
        )}
      </div>
    </section>
  );
}

/** The matrix shape at a glance: one bar per row, one block per cell. */
function PortalSketch({ rows }: { rows: RolePin[][] }) {
  return (
    <div className="flex flex-col gap-0.5 w-14 shrink-0" aria-hidden data-testid="portal-sketch">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-0.5">
          {row.map((cell, c) => (
            <span key={c} className="flex-1 h-1.5 rounded-sm bg-accent/40" title={cell.label} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One gesture adds a cell: pick a pin and it saves. The role's pins and the
 * admin's own pins are the menu; a typed label and URL cover the rest.
 */
function CellPicker({ options, label, onPick, testId }: {
  options: PickOption[];
  label: string;
  onPick: (pin: RolePin) => void;
  testId: string;
}) {
  const [custom, setCustom] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const canAdd = customLabel.trim() !== '' && customUrl.trim().startsWith('/');

  const pick = (key: string) => {
    if (key === PICK.CUSTOM) { setCustom(true); return; }
    const option = options.find((o) => o.key === key);
    if (option) onPick(option.pin);
  };

  return (
    <div className="space-y-1.5 w-full min-w-0">
      <select
        value=""
        onChange={(e) => pick(e.target.value)}
        className="select text-xs w-full"
        aria-label={label}
        data-testid={testId}
      >
        <option value="" disabled>{label}…</option>
        {options.some((o) => o.source === PICK.ROLE) && (
          <optgroup label="Role pins">
            {options.filter((o) => o.source === PICK.ROLE).map((o) => <option key={o.key} value={o.key}>{o.pin.label}</option>)}
          </optgroup>
        )}
        {options.some((o) => o.source === PICK.MINE) && (
          <optgroup label="My pins">
            {options.filter((o) => o.source === PICK.MINE).map((o) => <option key={o.key} value={o.key}>{o.pin.label}</option>)}
          </optgroup>
        )}
        <option value={PICK.CUSTOM}>Label and URL…</option>
      </select>
      {custom && (
        // Stacked, full width: the same form fits a 12rem cell slot and a full-width row slot.
        <div className="flex flex-col gap-1.5" data-testid={`${testId}-custom`}>
          <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Label" className="input text-xs w-full" aria-label="View label" />
          <input type="text" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="/escalations/available?role=…" className="input text-xs font-mono w-full" aria-label="View URL" />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setCustom(false); setCustomLabel(''); setCustomUrl(''); }}
              className="px-2 py-1 text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!canAdd) return;
                onPick({ label: customLabel.trim(), url: customUrl.trim(), badge: true });
                setCustom(false); setCustomLabel(''); setCustomUrl('');
              }}
              disabled={!canAdd}
              className="px-2.5 py-1 text-xs rounded bg-accent text-text-inverse hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
